import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CampaignStatus,
  CaptureVerdict,
  JobStatus,
  Overall as DbOverall,
  PhotoStatus,
  Prisma,
  SnapshotSource,
  SubmissionStatus,
  type Photo,
} from '@prisma/client';
import type {
  BestInClassItem,
  ComplianceTrendPoint,
  ComplianceTurnaround,
  Criterion,
  CriterionResult,
  Flag,
  Overall,
  SessionUser,
  StoreSales,
  StoreScore,
} from '@wally/types';
import sharp from 'sharp';

import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { storeRollup, ApplicabilityError } from '../scoring/store-rollup';
import { loadStoreCompliance } from '../scoring/store-compliance';

// A Verdict joined with its Rubric (+ campaign key) — everything presentVerdict
// needs to emit the reviewer-bench ScoreResult (the rubricVersion stamp and the
// criteria the flags are re-derived from).
type VerdictWithRubric = Prisma.VerdictGetPayload<{
  include: { rubric: { include: { campaign: { select: { key: true } } } } };
}>;

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

/**
 * An OPTIONAL analytics date window. Both bounds are optional and the whole
 * object is optional — when nothing is supplied the surface is all-time (the
 * unchanged, backward-compatible behaviour every existing caller relies on).
 */
export interface DateWindow {
  from?: Date;
  to?: Date;
}

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
            verdict: {
              include: {
                rubric: { include: { campaign: { select: { key: true } } } },
              },
            },
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
        // The reviewer bench reads `photo.score` (the @wally/sdk SubmissionPhoto
        // contract), so emit `score:`, not `verdict:`. Carries the verdict id
        // (the review endpoint is keyed by verdict id), the rubricVersion stamp,
        // and the re-derived flags the bench consumes.
        score: p.verdict ? this.presentVerdict(p.verdict) : null,
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
  async campaignQueue(orgId: string, campaignId: string, window?: DateWindow) {
    const campaign = await this.requireCampaign(orgId, campaignId);

    // Only ACTIVE stores belong in the reviewer queue / leaderboard / snapshot
    // counts — a closed store is retired, so it shouldn't drag pass-rate or
    // appear as a row to action. (captureSnapshot + campaignTurnaround build on
    // this same set, so all three roll-ups stay consistent.)
    const stores = await this.prisma.store.findMany({
      where: { orgId, closedAt: null },
      orderBy: [{ brand: 'asc' }, { name: 'asc' }],
    });

    const scores: StoreScore[] = [];
    const skipped: { storeId: string; storeName: string; reason: string }[] = [];

    for (const store of stores) {
      const built = await this.buildStoreScore(
        store.id,
        campaign.id,
        {
          storeName: store.name,
          campaignKey: campaign.key,
          region: store.region,
          areaManager: store.areaManager,
          storeType: store.storeType,
        },
        window,
      );
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

  /**
   * Per-store sales rollup for a campaign — units + revenue logged across the
   * (optional) window, used by the sales-primary leaderboard. The window bounds
   * the sale DAY (SalesEntry.soldOn, date-only). Every ACTIVE store is returned,
   * including ones with no sales yet (units/revenue = 0), so the leaderboard
   * shows the full roster — consistent with the queue's ACTIVE-only store set.
   */
  async campaignSales(
    orgId: string,
    campaignId: string,
    window?: DateWindow,
  ): Promise<StoreSales[]> {
    await this.requireCampaign(orgId, campaignId);

    const stores = await this.prisma.store.findMany({
      where: { orgId, closedAt: null },
      select: { id: true, name: true, region: true },
      orderBy: [{ brand: 'asc' }, { name: 'asc' }],
    });

    // soldOn is a date-only column; bound it by the window when supplied.
    const soldOn =
      window && (window.from || window.to)
        ? {
            ...(window.from ? { gte: window.from } : {}),
            ...(window.to ? { lte: window.to } : {}),
          }
        : undefined;

    const grouped = await this.prisma.salesEntry.groupBy({
      by: ['storeId'],
      where: { orgId, campaignId, ...(soldOn ? { soldOn } : {}) },
      _sum: { units: true, revenue: true },
    });
    const byStore = new Map(grouped.map((g) => [g.storeId, g._sum]));

    return stores.map((s) => {
      const sum = byStore.get(s.id);
      return {
        storeId: s.id,
        storeName: s.name,
        region: s.region,
        units: sum?.units ?? 0,
        revenue: sum?.revenue ?? 0,
      };
    });
  }

  /**
   * Operational turnaround for a campaign: how fast AI verdicts get a reviewer
   * action, and which stores needed the most rework (override).
   *
   * MIGRATED to the live FixtureCapture pipeline (from the legacy
   * Review/Verdict pipeline). A "review" is a FixtureCapture with a reviewer
   * decision (`reviewedAt` not null — the reviewer-override fields on the capture):
   *   - reviewedCount   = captures with reviewedAt set;
   *   - turnaround time = uploadedAt → reviewedAt (per capture);
   *   - revisionCount   = reviewed captures whose human override differs from the
   *                       AI verdict (a genuine rework, vs. a confirm-in-place);
   *   - awaitingReview  = captures whose EFFECTIVE verdict is NEEDS_REVIEW with
   *                       reviewedAt null (the honest still-waiting backlog);
   *   - oldestPendingAgeMinutes = the oldest such capture's uploadedAt/scoredAt age.
   * The TurnaroundDto OUTPUT shape is unchanged.
   */
  async campaignTurnaround(
    orgId: string,
    campaignId: string,
    window?: DateWindow,
  ): Promise<ComplianceTurnaround> {
    await this.requireCampaign(orgId, campaignId);

    // All captures for the campaign with the store name (for mostRevised). The
    // window (when supplied) bounds reviewedAt for the reviewed set and the
    // capture's upload/score time for the pending set — applied in memory below
    // since the two need different timestamp predicates.
    const captures = await this.prisma.fixtureCapture.findMany({
      where: { campaignId },
      select: {
        storeId: true,
        verdict: true,
        overrideVerdict: true,
        uploadedAt: true,
        scoredAt: true,
        reviewedAt: true,
        store: { select: { name: true } },
      },
    });

    const inWin = (d: Date | null | undefined): boolean => {
      if (!window || (!window.from && !window.to)) return true;
      if (!d) return false;
      if (window.from && d < window.from) return false;
      if (window.to && d > window.to) return false;
      return true;
    };

    // Reviewed = a human decision was stamped (reviewedAt). Window bounds the
    // reviewer action time — absent window = all-time, unchanged.
    const reviewed = captures.filter(
      (c) => c.reviewedAt != null && inWin(c.reviewedAt),
    );

    // Turnaround per reviewed capture: uploadedAt → reviewedAt. A capture missing
    // an uploadedAt (a reviewer judged a never-shot fixture) contributes no
    // duration but still counts as reviewed.
    const durations = reviewed
      .map((c) =>
        c.uploadedAt && c.reviewedAt
          ? (c.reviewedAt.getTime() - c.uploadedAt.getTime()) / 60000
          : null,
      )
      .filter((m): m is number => m != null && m >= 0)
      .sort((a, b) => a - b);
    const avg =
      durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : null;
    const median =
      durations.length > 0
        ? (durations[Math.floor((durations.length - 1) / 2)] ?? null)
        : null;

    // A revision = a reviewed capture whose human override differs from the AI
    // verdict (the reviewer changed the call — the FixtureCapture equivalent of a
    // non-CONFIRM Review). An override that matches the AI verdict is a confirm.
    const revisions = reviewed.filter(
      (c) => c.overrideVerdict != null && c.overrideVerdict !== c.verdict,
    );
    const byStore = new Map<
      string,
      { storeId: string; storeName: string; revisions: number }
    >();
    for (const c of revisions) {
      const cur = byStore.get(c.storeId) ?? {
        storeId: c.storeId,
        storeName: c.store.name,
        revisions: 0,
      };
      cur.revisions += 1;
      byStore.set(c.storeId, cur);
    }
    const mostRevised = [...byStore.values()]
      .sort((a, b) => b.revisions - a.revisions)
      .slice(0, 5);

    // The actionable backlog the average hides: captures whose EFFECTIVE verdict
    // (override ?? ai) is NEEDS_REVIEW with NO reviewer decision yet. The window
    // bounds the capture's upload/score time so the backlog is for the period.
    const pending = captures.filter((c) => {
      const effective = c.overrideVerdict ?? c.verdict;
      if (effective !== CaptureVerdict.NEEDS_REVIEW) return false;
      if (c.reviewedAt != null) return false;
      return inWin(c.uploadedAt ?? c.scoredAt);
    });
    const now = Date.now();
    const pendingAges = pending
      .map((c) => c.uploadedAt ?? c.scoredAt)
      .filter((d): d is Date => d != null)
      .map((d) => now - d.getTime());
    const oldestPendingAgeMinutes =
      pendingAges.length > 0
        ? Math.round(Math.max(...pendingAges) / 60000)
        : null;

    return {
      reviewedCount: reviewed.length,
      avgReviewMinutes: avg,
      medianReviewMinutes: median,
      revisionCount: revisions.length,
      awaitingReview: pending.length,
      oldestPendingAgeMinutes,
      mostRevised,
    };
  }

  /**
   * Capture today's compliance rollup for a campaign as a snapshot (idempotent
   * per day via upsert on (campaignId, dateKey)). Reuses the live queue rollup,
   * so the snapshot matches exactly what the dashboard shows right now.
   *
   * `source` records who wrote the point. The write rule keeps the CRON row
   * canonical: a MANUAL capture (the admin "capture now" button) refreshes its
   * own MANUAL point but NEVER overwrites an existing CRON row for the same day —
   * so an intra-day manual capture can't clobber the authoritative end-of-day
   * value. CRON always writes (and may overwrite a same-day MANUAL placeholder).
   */
  async captureSnapshot(
    orgId: string,
    campaignId: string,
    source: SnapshotSource = SnapshotSource.MANUAL,
  ): Promise<ComplianceTrendPoint> {
    const queue = await this.campaignQueue(orgId, campaignId);
    const stores = queue.stores;
    const passing = (s: StoreScore) =>
      s.fixtures.filter(
        (f) =>
          f.status === 'scored' &&
          (f.overall === 'perfect' || f.overall === 'good'),
      ).length;
    const agg = {
      storeCount: stores.length,
      onTrack: stores.filter(
        (s) => s.overall === 'perfect' || s.overall === 'good',
      ).length,
      needsReview: stores.filter((s) => s.overall === 'needs_review').length,
      failing: stores.filter((s) => s.overall === 'not_good').length,
      incomplete: stores.filter((s) => s.overall === 'incomplete').length,
      submitted: stores.reduce((a, s) => a + s.submitted, 0),
      expected: stores.reduce((a, s) => a + s.expected, 0),
      passing: stores.reduce((a, s) => a + passing(s), 0),
    };
    const dateKey = new Date().toISOString().slice(0, 10);

    const existing = await this.prisma.complianceSnapshot.findUnique({
      where: { campaignId_dateKey: { campaignId, dateKey } },
      select: { source: true },
    });
    // Manual capture must not overwrite the day's canonical CRON row — return it
    // untouched so the trend keeps the authoritative value.
    if (
      existing &&
      existing.source === SnapshotSource.CRON &&
      source === SnapshotSource.MANUAL
    ) {
      const row = await this.prisma.complianceSnapshot.findUniqueOrThrow({
        where: { campaignId_dateKey: { campaignId, dateKey } },
      });
      return toTrendPoint(row);
    }

    const row = await this.prisma.complianceSnapshot.upsert({
      where: { campaignId_dateKey: { campaignId, dateKey } },
      create: { orgId, campaignId, dateKey, source, ...agg },
      update: { ...agg, source, capturedAt: new Date() },
    });
    return toTrendPoint(row);
  }

  /**
   * Prune a single bad trend point by its dateKey (e.g. an empty-day capture
   * skewing the line). ADMIN-only, org-scoped. No-op safe: a missing point is
   * not an error — the goal state (point gone) is already met.
   */
  async deleteTrendPoint(
    orgId: string,
    campaignId: string,
    dateKey: string,
  ): Promise<void> {
    await this.requireCampaign(orgId, campaignId);
    await this.prisma.complianceSnapshot.deleteMany({
      where: { orgId, campaignId, dateKey },
    });
  }

  /** The campaign's compliance snapshots over time, oldest first. */
  async campaignTrend(
    orgId: string,
    campaignId: string,
  ): Promise<ComplianceTrendPoint[]> {
    await this.requireCampaign(orgId, campaignId);
    const rows = await this.prisma.complianceSnapshot.findMany({
      where: { campaignId },
      orderBy: { capturedAt: 'asc' },
    });
    return rows.map(toTrendPoint);
  }

  /** One store's rolled-up score for a campaign. */
  async storeScore(orgId: string, storeId: string, campaignId: string) {
    const store = await this.requireStore(orgId, storeId);
    const campaign = await this.requireCampaign(orgId, campaignId);

    const built = await this.buildStoreScore(store.id, campaign.id, {
      storeName: store.name,
      campaignKey: campaign.key,
      region: store.region,
      areaManager: store.areaManager,
      storeType: store.storeType,
    });
    if (built.kind === 'empty') {
      throw new BadRequestException(built.reason);
    }
    return built.score;
  }

  /**
   * The shared core both queue and store-score use. Builds a FixtureOutcome[]
   * from the live FixtureCapture pipeline (the CANONICAL source the manager
   * floor map writes to) and defers to the pure storeRollup().
   *
   * SOURCE (migrated from the legacy Submission/Photo/Verdict pipeline):
   *   - EXPECTED fixtures = the store's applicable Placements for the campaign
   *     (Placement.applicable=true; label = placement.label || fixture.name;
   *     fixtureKey = the stable fixtureId — the join key the capture loop uses).
   *   - VERDICT per fixture = its FixtureCapture's EFFECTIVE verdict
   *     (`overrideVerdict ?? verdict`), mapped CaptureVerdict → core Overall:
   *     PASS→good, FAIL→not_good, NEEDS_REVIEW→needs_review.
   *
   * Outcome status per fixture (see loadStoreCompliance):
   *   not_applicable → Placement.applicable = false
   *   scored         → a capture with a photo + an effective verdict (in-window)
   *   not_submitted  → applicable placement with no in-window scored capture yet
   *
   * The optional `window` bounds which captures count (by uploadedAt, falling
   * back to scoredAt). Absent window = all-time (unchanged).
   */
  private async buildStoreScore(
    storeId: string,
    campaignId: string,
    meta: {
      storeName: string;
      campaignKey: string;
      region?: string | null;
      areaManager?: string | null;
      storeType?: string | null;
    },
    window?: DateWindow,
  ): Promise<
    | { kind: 'score'; score: StoreScore }
    | { kind: 'empty'; reason: string }
  > {
    const { outcomes, hasPlacements } = await loadStoreCompliance(
      this.prisma,
      storeId,
      campaignId,
      window,
    );

    if (!hasPlacements) {
      return {
        kind: 'empty',
        reason: `store has no fixtures configured for this campaign`,
      };
    }

    // rubricVersions stamp = the campaign's active rubric versions. FixtureCapture
    // (unlike the legacy Verdict) carries no per-shot rubric FK, so the StoreScore
    // is stamped with the campaign's live grading versions instead — the rubrics
    // the capture scorer actually grades against (empty array when none exist).
    const rubricVersions = await this.rubricVersionsForCampaign(
      campaignId,
      meta.campaignKey,
    );

    try {
      const score = storeRollup({
        storeId,
        storeName: meta.storeName,
        campaignKey: meta.campaignKey,
        fixtures: outcomes,
        rubricVersions,
      });
      return {
        kind: 'score',
        // submissionId is retained on the contract but is no longer sourced from
        // the legacy Submission row (the capture pipeline has no submission). The
        // reviewer-console deep-link is migrated in a later batch; keep it null
        // here rather than re-querying the orphaned Submission.
        score: {
          ...score,
          submissionId: null,
          region: meta.region ?? null,
          areaManager: meta.areaManager ?? null,
          storeType: meta.storeType ?? null,
        },
      };
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
   * The distinct rubric stamps (`<fixtureKey>.<campaignKey>.v<version>`) for a
   * campaign's ACTIVE rubric versions — the live grading standards the capture
   * scorer resolves (active row per fixtureKey, else highest version). This
   * replaces the per-submission verdict-derived stamp: FixtureCapture has no
   * rubric FK, so the StoreScore is stamped with the campaign's live rubric
   * versions instead. Returns [] when the campaign has no rubrics.
   */
  private async rubricVersionsForCampaign(
    campaignId: string,
    campaignKey: string,
  ): Promise<string[]> {
    const rubrics = await this.prisma.rubric.findMany({
      where: { campaignId },
      select: { fixtureKey: true, version: true, active: true },
      orderBy: { version: 'desc' },
    });
    // One stamp per fixtureKey: the active version if any, else the highest —
    // mirroring resolveActiveRubric's "active, else latest" live-version rule.
    const byFixture = new Map<string, number>();
    for (const r of rubrics) {
      const cur = byFixture.get(r.fixtureKey);
      if (cur === undefined) {
        byFixture.set(r.fixtureKey, r.version);
      }
      if (r.active) {
        byFixture.set(r.fixtureKey, r.version);
      }
    }
    const stamps = [...byFixture.entries()].map(
      ([fixtureKey, version]) => `${fixtureKey}.${campaignKey}.v${version}`,
    );
    return [...new Set(stamps)].sort();
  }

  // ----- shared guards / presenters ----------------------------------------

  private async requireStore(orgId: string, storeId: string) {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, orgId },
      select: {
        id: true,
        name: true,
        brand: true,
        region: true,
        areaManager: true,
        storeType: true,
      },
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
      bestInClass: p.bestInClass,
    }));
  }

  /**
   * Re-open a photo for scoring: reset its ScoreJob to PENDING (runAfter now,
   * attempts 0, lastError + lockedAt cleared) and the Photo back to UPLOADED, so
   * the durable-queue worker re-enqueues it. The escape hatch for a photo parked
   * FAILED after a transient outage (or to re-grade against a newer rubric).
   *
   * Idempotent and safe to call on a non-FAILED photo (e.g. one stuck SCORING).
   * Creates a job if one was somehow lost so the photo never re-enqueues into
   * the void. The existing Verdict (if any) is left in place; a successful
   * re-score upserts over it.
   */
  async rescorePhoto(
    orgId: string,
    photoId: string,
  ): Promise<{ id: string; status: PhotoStatus }> {
    const photo = await this.prisma.photo.findFirst({
      where: { id: photoId, submission: { orgId } },
      select: { id: true, job: { select: { id: true } } },
    });
    if (!photo) throw new NotFoundException('photo not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      if (photo.job) {
        await tx.scoreJob.update({
          where: { id: photo.job.id },
          data: {
            status: JobStatus.PENDING,
            attempts: 0,
            lastError: null,
            lockedAt: null,
            runAfter: new Date(),
          },
        });
      } else {
        // Job lost (shouldn't happen — Photo.job is 1:1) — recreate it so the
        // photo can actually re-enqueue rather than silently dead-end.
        await tx.scoreJob.create({
          data: { photoId: photo.id, status: JobStatus.PENDING },
        });
      }
      return tx.photo.update({
        where: { id: photo.id },
        data: { status: PhotoStatus.UPLOADED },
        select: { id: true, status: true },
      });
    });
    return updated;
  }

  /**
   * Toggle a store execution photo as best-in-class (a showcase exemplar).
   * Audited: stamps who curated it (`curatedById`) and when (`curatedAt`) on
   * every flip, so a reverted exemplar isn't an unattributable mystery.
   */
  async setBestInClass(
    orgId: string,
    actorId: string,
    photoId: string,
    value: boolean,
  ): Promise<{ id: string; bestInClass: boolean }> {
    const photo = await this.prisma.photo.findFirst({
      where: { id: photoId, submission: { orgId } },
      select: { id: true },
    });
    if (!photo) throw new NotFoundException('photo not found');
    return this.prisma.photo.update({
      where: { id: photoId },
      data: { bestInClass: value, curatedById: actorId, curatedAt: new Date() },
      select: { id: true, bestInClass: true },
    });
  }

  /** The campaign's best-in-class execution photos — exemplars to show stores. */
  async bestInClass(
    orgId: string,
    campaignId: string,
  ): Promise<BestInClassItem[]> {
    await this.requireCampaign(orgId, campaignId);
    const photos = await this.prisma.photo.findMany({
      where: { bestInClass: true, submission: { orgId, campaignId } },
      orderBy: { createdAt: 'desc' },
      include: {
        submission: {
          select: { storeId: true, store: { select: { name: true } } },
        },
        verdict: { select: { overall: true } },
      },
    });
    return photos.map((p) => ({
      photoId: p.id,
      url: this.storage.signedGetUrl(p.storageKey),
      storeId: p.submission.storeId,
      storeName: p.submission.store.name,
      fixtureKey: p.fixtureKey,
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

  /**
   * Present a Verdict as the reviewer-bench ScoreResult the web reads as
   * `photo.score`. `id` is the VERDICT id (the review endpoint is keyed by
   * verdict id, not photo id). `rubricVersion` is the canonical stamp and
   * `flags` are re-derived from the persisted per-criterion results + the
   * rubric's criteria — exactly the set fixtureRollup() flagged when scoring,
   * recomputed here so we don't have to persist them on the Verdict.
   */
  private presentVerdict(v: VerdictWithRubric) {
    const criteria = v.rubric.criteria as unknown as Criterion[];
    const results = v.results as unknown as CriterionResult[];
    const rubricVersion = `${v.rubric.fixtureKey}.${v.rubric.campaign.key}.v${v.rubric.version}`;
    return {
      id: v.id,
      overall: dbOverallToCore(v.overall),
      needsReview: v.needsReview,
      confidence: v.confidence,
      flags: deriveFlags(results, criteria),
      results,
      rubricVersion,
      modelId: v.modelId,
      promptVersion: v.promptVersion,
      createdAt: v.createdAt,
    };
  }
}

/**
 * Re-derive the flagged criteria for a scored photo from its persisted results
 * and the rubric's criteria — the same set fixtureRollup() produced at score
 * time (a criterion is flagged when it failed, was unsure, or the model never
 * graded it). Kept in sync with rollup.ts's flag rule.
 */
function deriveFlags(
  results: CriterionResult[],
  criteria: Criterion[],
): Flag[] {
  const byId = new Map(results.map((r) => [r.id, r]));
  const flags: Flag[] = [];
  for (const c of criteria) {
    const v = byId.get(c.id);
    if (!v || v.verdict === 'unsure' || v.verdict === 'fail') {
      flags.push({ id: c.id, kind: c.kind, text: c.text });
    }
  }
  return flags;
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

/** Map a ComplianceSnapshot DB row to the shared trend-point contract. */
function toTrendPoint(r: {
  dateKey: string;
  capturedAt: Date;
  source: SnapshotSource;
  storeCount: number;
  onTrack: number;
  needsReview: number;
  failing: number;
  incomplete: number;
  submitted: number;
  expected: number;
  passing: number;
}): ComplianceTrendPoint {
  return {
    dateKey: r.dateKey,
    capturedAt: r.capturedAt.toISOString(),
    source: r.source,
    storeCount: r.storeCount,
    onTrack: r.onTrack,
    needsReview: r.needsReview,
    failing: r.failing,
    incomplete: r.incomplete,
    submitted: r.submitted,
    expected: r.expected,
    passing: r.passing,
  };
}
