import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CampaignStatus,
  JobStatus,
  Overall as DbOverall,
  PhotoStatus,
  SubmissionStatus,
  type Photo,
  type Verdict,
} from '@prisma/client';
import type {
  FixtureOutcome,
  FixtureStatus,
  Overall,
  SessionUser,
  StoreScore,
} from '@wally/types';
import sharp from 'sharp';

import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { storeRollup, ApplicabilityError } from '../scoring/store-rollup';

import type { CreateSubmissionInput } from './submission.dto';

// =============================================================================
// SubmissionService — capture + queue + rollup.
// =============================================================================
//
// Owns the store-manager capture flow and the reviewer queue:
//   1. create a submission (store × campaign, idempotent on the unique pair);
//   2. upload a photo → persist bytes via StorageService, create a Photo and a
//      PENDING ScoreJob (the durable queue the worker drains SKIP-LOCKED);
//   3. read a submission with its photos + verdicts;
//   4. build the per-campaign QUEUE: each store's FixtureOutcome[] from its
//      applicable StoreFixtures + Photos + Verdicts → storeRollup() → StoreScore,
//      sorted attention-first.
//
// SECURITY: never log image bytes. Photos are served only via a signed token
// (StorageService.signedGetUrl), never by raw storage key.
// =============================================================================

// Overall in the DB enum is UPPERCASE (PERFECT/GOOD/NOT_GOOD/NEEDS_REVIEW); the
// shared @wally/types Overall and the rollup core are lowercase. One exhaustive
// mapping at the boundary — throws on an unknown value rather than silently
// producing undefined (which a "no silent pass" core must never see).
function dbOverallToCore(db: DbOverall): Overall {
  switch (db) {
    case DbOverall.PERFECT:
      return 'perfect';
    case DbOverall.GOOD:
      return 'good';
    case DbOverall.NOT_GOOD:
      return 'not_good';
    case DbOverall.NEEDS_REVIEW:
      return 'needs_review';
    default: {
      const _exhaustive: never = db;
      throw new Error(`unmapped Overall enum value: ${String(_exhaustive)}`);
    }
  }
}

// Attention-first ordering for the reviewer queue: the things that need a human
// float to the top. Lower rank = shown first.
const STORE_BAND_RANK: Record<StoreScore['overall'], number> = {
  not_good: 0,
  needs_review: 1,
  incomplete: 2,
  good: 3,
  perfect: 4,
};

const MAX_PHOTO_BYTES = 15 * 1024 * 1024; // 15 MB — generous for a phone photo.
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

@Injectable()
export class SubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // ----- create ------------------------------------------------------------

  /**
   * Create (or return the existing) submission for a store × campaign. The pair
   * is unique, so this is idempotent: a store manager re-opening the flow gets
   * back the same submission rather than a 409.
   */
  /**
   * Resolve the signed-in store manager's checklist: their store + the active
   * campaign, opening (or resuming) the submission. So /capture needs no ID.
   */
  async currentForManager(user: SessionUser) {
    if (!user.storeId) {
      throw new NotFoundException(
        'No store is linked to this account. Ask head office to re-send your checklist link.',
      );
    }
    const campaign = await this.prisma.campaign.findFirst({
      where: { orgId: user.orgId, status: CampaignStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
    });
    if (!campaign) {
      throw new NotFoundException('There is no active campaign right now.');
    }
    const submission = await this.create(user.orgId, {
      storeId: user.storeId,
      campaignId: campaign.id,
    });
    return { submissionId: submission.id, campaignKey: campaign.key };
  }

  async create(orgId: string, input: CreateSubmissionInput) {
    const store = await this.requireStore(orgId, input.storeId);
    await this.requireCampaign(orgId, input.campaignId);

    const existing = await this.prisma.submission.findUnique({
      where: {
        storeId_campaignId: {
          storeId: input.storeId,
          campaignId: input.campaignId,
        },
      },
    });
    if (existing) return existing;

    return this.prisma.submission.create({
      data: {
        orgId,
        storeId: store.id,
        campaignId: input.campaignId,
        status: SubmissionStatus.PENDING,
      },
    });
  }

  // ----- photo upload ------------------------------------------------------

  /**
   * Persist an uploaded photo and enqueue it for scoring. Transactional after
   * the bytes land on disk: Photo + ScoreJob are created together so the worker
   * never sees a Photo without a job (or vice-versa). Returns the Photo with a
   * short-lived signed URL the client can render immediately.
   */
  async addPhoto(
    orgId: string,
    submissionId: string,
    fixtureKey: string,
    file: { buffer: Buffer; mimetype: string; size: number },
  ) {
    const submission = await this.requireSubmission(orgId, submissionId);

    if (!file?.buffer?.length) {
      throw new BadRequestException('no photo file received');
    }
    if (file.size > MAX_PHOTO_BYTES) {
      throw new BadRequestException('photo exceeds 15MB limit');
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException(
        `unsupported image type "${file.mimetype}" (allowed: jpeg, png, webp)`,
      );
    }

    // Read dimensions for the report/UI. Never log the bytes — only metadata.
    let width: number | null = null;
    let height: number | null = null;
    try {
      const meta = await sharp(file.buffer).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
    } catch {
      // A file that sharp can't parse isn't a real image — reject loudly.
      throw new BadRequestException('file is not a readable image');
    }

    const ext = mimeToExt(file.mimetype);
    const storageKey = await this.storage.put(file.buffer, {
      ext,
      prefix: `photos/${submission.campaignId}`,
    });

    const photo = await this.prisma.$transaction(async (tx) => {
      const created = await tx.photo.create({
        data: {
          submissionId: submission.id,
          fixtureKey,
          storageKey,
          status: PhotoStatus.UPLOADED,
          width,
          height,
        },
      });
      // The durable queue. One job per photo (Photo.job is 1:1). Worker claims
      // PENDING rows with SELECT ... FOR UPDATE SKIP LOCKED.
      await tx.scoreJob.create({
        data: { photoId: created.id, status: JobStatus.PENDING },
      });
      // First photo moves the submission out of PENDING into PARTIAL.
      if (submission.status === SubmissionStatus.PENDING) {
        await tx.submission.update({
          where: { id: submission.id },
          data: { status: SubmissionStatus.PARTIAL },
        });
      }
      return created;
    });

    return this.presentPhoto(photo);
  }

  // ----- read --------------------------------------------------------------

  /** A submission with its photos and each photo's verdict (if scored). */
  async getOne(orgId: string, submissionId: string) {
    const submission = await this.prisma.submission.findFirst({
      where: { id: submissionId, orgId },
      include: {
        store: { select: { id: true, name: true, brand: true } },
        campaign: { select: { id: true, key: true, name: true } },
        photos: {
          orderBy: { createdAt: 'asc' },
          include: {
            verdict: true,
            job: { select: { status: true, attempts: true, lastError: true } },
          },
        },
      },
    });
    if (!submission) throw new NotFoundException('submission not found');

    // The checklist is the store's APPLICABLE fixtures (not just what's been
    // uploaded), so the manager sees what's still outstanding.
    const fixtures = await this.prisma.storeFixture.findMany({
      where: {
        storeId: submission.storeId,
        campaignId: submission.campaignId,
        applicable: true,
      },
      orderBy: { order: 'asc' },
      select: { fixtureKey: true, label: true, order: true },
    });

    return {
      id: submission.id,
      status: submission.status,
      submittedAt: submission.submittedAt,
      createdAt: submission.createdAt,
      storeId: submission.storeId,
      campaignId: submission.campaignId,
      // Flat names match the @wally/sdk Submission contract the web reads.
      storeName: submission.store.name,
      campaignKey: submission.campaign.key,
      store: submission.store,
      campaign: submission.campaign,
      fixtures,
      photos: submission.photos.map((p) => ({
        ...this.presentPhoto(p),
        verdict: p.verdict ? this.presentVerdict(p.verdict) : null,
        job: p.job,
      })),
    };
  }

  // ----- queue / store score ----------------------------------------------

  /**
   * The reviewer queue for a campaign: one StoreScore per store, sorted
   * attention-first (not_good, needs_review, incomplete, good, perfect). Stores
   * with no applicable fixtures at all are surfaced as a soft "no fixtures" row
   * rather than crashing the whole queue on one mis-configured store.
   */
  async campaignQueue(orgId: string, campaignId: string) {
    const campaign = await this.requireCampaign(orgId, campaignId);

    const stores = await this.prisma.store.findMany({
      where: { orgId },
      orderBy: [{ brand: 'asc' }, { name: 'asc' }],
    });

    const scores: StoreScore[] = [];
    const skipped: { storeId: string; storeName: string; reason: string }[] = [];

    for (const store of stores) {
      const built = await this.buildStoreScore(store.id, campaign.id, {
        storeName: store.name,
        campaignKey: campaign.key,
      });
      if (built.kind === 'score') scores.push(built.score);
      else skipped.push({ storeId: store.id, storeName: store.name, reason: built.reason });
    }

    scores.sort(
      (a, b) =>
        STORE_BAND_RANK[a.overall] - STORE_BAND_RANK[b.overall] ||
        a.storeName.localeCompare(b.storeName),
    );

    return { campaignId: campaign.id, campaignKey: campaign.key, stores: scores, skipped };
  }

  /** One store's rolled-up score for a campaign. */
  async storeScore(orgId: string, storeId: string, campaignId: string) {
    const store = await this.requireStore(orgId, storeId);
    const campaign = await this.requireCampaign(orgId, campaignId);

    const built = await this.buildStoreScore(store.id, campaign.id, {
      storeName: store.name,
      campaignKey: campaign.key,
    });
    if (built.kind === 'empty') {
      throw new BadRequestException(built.reason);
    }
    return built.score;
  }

  /**
   * The shared core both queue and store-score use. Builds a FixtureOutcome[]
   * from the store's StoreFixtures (applicability + order), the photos uploaded
   * for each fixture, and their verdicts, then defers to the pure storeRollup().
   *
   * Outcome status per fixture:
   *   not_applicable → StoreFixture.applicable = false
   *   scored         → has a photo with a verdict
   *   not_submitted  → applicable but no scored photo yet (uploaded-but-pending
   *                    also counts as not_submitted — nothing to grade on yet)
   */
  private async buildStoreScore(
    storeId: string,
    campaignId: string,
    meta: { storeName: string; campaignKey: string },
  ): Promise<
    | { kind: 'score'; score: StoreScore }
    | { kind: 'empty'; reason: string }
  > {
    const fixtures = await this.prisma.storeFixture.findMany({
      where: { storeId, campaignId },
      orderBy: { order: 'asc' },
    });

    if (fixtures.length === 0) {
      return {
        kind: 'empty',
        reason: `store has no fixtures configured for this campaign`,
      };
    }

    // Pull the store's photos + verdicts for this campaign in one query, then
    // index the freshest verdict-bearing photo per fixtureKey.
    const submission = await this.prisma.submission.findUnique({
      where: { storeId_campaignId: { storeId, campaignId } },
      include: {
        photos: {
          orderBy: { createdAt: 'desc' },
          include: { verdict: { select: { id: true, overall: true } } },
        },
      },
    });

    const scoredByFixture = new Map<string, { photoId: string; overall: Overall }>();
    for (const photo of submission?.photos ?? []) {
      if (scoredByFixture.has(photo.fixtureKey)) continue; // keep newest only
      if (photo.verdict) {
        scoredByFixture.set(photo.fixtureKey, {
          photoId: photo.id,
          overall: dbOverallToCore(photo.verdict.overall),
        });
      }
    }

    const outcomes: FixtureOutcome[] = fixtures.map((f) => {
      if (!f.applicable) {
        return {
          fixture: f.fixtureKey,
          label: f.label,
          status: 'not_applicable' as FixtureStatus,
        };
      }
      const scored = scoredByFixture.get(f.fixtureKey);
      if (scored) {
        return {
          fixture: f.fixtureKey,
          label: f.label,
          status: 'scored' as FixtureStatus,
          overall: scored.overall,
          photoId: scored.photoId,
        };
      }
      return {
        fixture: f.fixtureKey,
        label: f.label,
        status: 'not_submitted' as FixtureStatus,
      };
    });

    // rubricVersions stamp = the distinct rubric stamps backing the scored
    // verdicts. Resolve them from the verdicts' rubrics so the StoreScore can be
    // traced to exact rubric versions.
    const rubricVersions = await this.rubricVersionsFor(submission?.id);

    try {
      const score = storeRollup({
        storeId,
        storeName: meta.storeName,
        campaignKey: meta.campaignKey,
        fixtures: outcomes,
        rubricVersions,
      });
      return { kind: 'score', score };
    } catch (err) {
      if (err instanceof ApplicabilityError) {
        // Every fixture marked "we don't have it" — nothing to grade. Surface it
        // softly so one mis-configured store doesn't sink the whole queue.
        return { kind: 'empty', reason: err.message };
      }
      throw err;
    }
  }

  /**
   * The distinct rubric stamps (`<fixtureKey>.<campaignKey>.v<version>`) behind a
   * submission's verdicts. Returns [] when nothing is scored yet.
   */
  private async rubricVersionsFor(submissionId?: string): Promise<string[]> {
    if (!submissionId) return [];
    const verdicts = await this.prisma.verdict.findMany({
      where: { photo: { submissionId } },
      select: {
        rubric: {
          select: {
            fixtureKey: true,
            version: true,
            campaign: { select: { key: true } },
          },
        },
      },
    });
    const stamps = verdicts.map(
      (v) => `${v.rubric.fixtureKey}.${v.rubric.campaign.key}.v${v.rubric.version}`,
    );
    return [...new Set(stamps)].sort();
  }

  // ----- shared guards / presenters ----------------------------------------

  private async requireStore(orgId: string, storeId: string) {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, orgId },
      select: { id: true, name: true, brand: true },
    });
    if (!store) throw new NotFoundException('store not found');
    return store;
  }

  private async requireCampaign(orgId: string, campaignId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, orgId },
      select: { id: true, key: true, name: true },
    });
    if (!campaign) throw new NotFoundException('campaign not found');
    return campaign;
  }

  private async requireSubmission(orgId: string, submissionId: string) {
    const submission = await this.prisma.submission.findFirst({
      where: { id: submissionId, orgId },
    });
    if (!submission) throw new NotFoundException('submission not found');
    return submission;
  }

  /**
   * Every execution image across the campaign's stores, newest first — the
   * gallery surface. Signed URLs only; bytes never logged.
   */
  async gallery(orgId: string, campaignId: string) {
    await this.requireCampaign(orgId, campaignId);
    const photos = await this.prisma.photo.findMany({
      where: { submission: { orgId, campaignId } },
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: {
        submission: { select: { storeId: true, store: { select: { name: true } } } },
        verdict: { select: { overall: true } },
      },
    });
    return photos.map((p) => ({
      id: p.id,
      url: this.storage.signedGetUrl(p.storageKey),
      storeId: p.submission.storeId,
      storeName: p.submission.store.name,
      fixtureKey: p.fixtureKey,
      status: p.status,
      overall: p.verdict ? dbOverallToCore(p.verdict.overall) : undefined,
    }));
  }

  /** Photo for transport: a signed URL, never the raw storage key. */
  private presentPhoto(p: Photo) {
    return {
      id: p.id,
      fixtureKey: p.fixtureKey,
      status: p.status,
      width: p.width,
      height: p.height,
      createdAt: p.createdAt,
      url: this.storage.signedGetUrl(p.storageKey),
    };
  }

  private presentVerdict(v: Verdict) {
    return {
      id: v.id,
      overall: dbOverallToCore(v.overall),
      needsReview: v.needsReview,
      confidence: v.confidence,
      modelId: v.modelId,
      promptVersion: v.promptVersion,
      results: v.results,
      createdAt: v.createdAt,
    };
  }
}

/** Map an accepted upload mime to the storage extension. */
function mimeToExt(mime: string): string {
  switch (mime) {
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    default:
      return '.jpg';
  }
}
