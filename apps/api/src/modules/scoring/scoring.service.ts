import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Overall as PrismaOverall,
  PhotoStatus,
  type Prisma,
} from '@prisma/client';
import sharp from 'sharp';
import { z } from 'zod';

import type {
  Criterion,
  Overall as TypesOverall,
  RollupRule,
  ScoreResult,
} from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

import { applyConfidenceFloor, fixtureRollup } from './rollup';
import { PROMPT_VERSION } from './prompt';
import { type ImageInput, VISION_PROVIDER, type VisionProvider } from './vision';

// =============================================================================
// ScoringService — orchestrates one photo from bytes to a stamped Verdict.
// =============================================================================
//
// scorePhoto(photoId) is the single entry point the durable-queue worker calls.
// It is the only place that wires the pure scoring core (rollup.ts) to the
// outside world (DB, disk, model):
//
//   1. load Photo → Submission → Campaign, and resolve the LATEST Rubric row
//      for (campaign, fixtureKey). Rubrics are append-only; a Verdict FKs the
//      exact version it was graded against (reproducibility — CLAUDE.md).
//   2. load the image (and optional reference) via StorageService, then
//      sharp-normalise to a sane JPEG so the model sees a predictable input
//      (EXIF-rotated, capped resolution, stripped metadata).
//   3. call the injected VisionProvider for per-criterion pass/fail/unsure.
//   4. applyConfidenceFloor(WALLY_CONFIDENCE_FLOOR) — a low-confidence pass/fail
//      becomes "unsure" so the rollup escalates it. No silent pass.
//   5. fixtureRollup(...) → one ScoreResult, stamped model+rubric+prompt.
//   6. upsert the Verdict and set Photo.status (SCORED / FAILED).
//
// SECURITY: image bytes are NEVER logged. Only ids, sizes, and outcomes.
// =============================================================================

/** Verdicts below this confidence are forced to needs_review. Read once. */
const ScoringEnv = z.object({
  WALLY_CONFIDENCE_FLOOR: z.coerce.number().min(0).max(1).default(0.7),
  // Cap the longest edge before sending to the model — keeps token/latency
  // cost bounded and normalises wildly different phone-camera resolutions.
  WALLY_VISION_MAX_EDGE: z.coerce.number().int().positive().default(1568),
});

/** zod shape of the criteria JSON persisted on Rubric.criteria. Validated on
 *  load so a malformed rubric fails this photo loudly instead of feeding the
 *  model garbage. */
const CriterionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['presence', 'aesthetic']),
  critical: z.boolean(),
  text: z.string().min(1),
});
const CriteriaSchema = z.array(CriterionSchema).min(1);

/** zod shape of Rubric.rollupRule. Falls back to the escalation-first default
 *  when a column is absent (older rows / partial JSON). */
const RollupRuleSchema = z
  .object({
    not_good_if_any_critical_fails: z.boolean().default(true),
    good_if_only_noncritical_fails: z.boolean().default(true),
  })
  .default({
    not_good_if_any_critical_fails: true,
    good_if_only_noncritical_fails: true,
  });

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);
  private readonly confidenceFloor: number;
  private readonly maxEdge: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(VISION_PROVIDER) private readonly vision: VisionProvider,
  ) {
    const cfg = ScoringEnv.parse(process.env);
    this.confidenceFloor = cfg.WALLY_CONFIDENCE_FLOOR;
    this.maxEdge = cfg.WALLY_VISION_MAX_EDGE;
  }

  /**
   * Score a single photo and persist a Verdict. Idempotent at the row level:
   * the Verdict is upserted on the unique photoId, so a retried job overwrites
   * the previous attempt's verdict rather than duplicating it.
   *
   * Throws (so the worker can retry/fail) when the photo, submission, campaign,
   * or a matching rubric can't be found, or when the vision call fails. On a
   * thrown error the photo is left in SCORING — the worker owns the FAILED
   * transition after the retry budget is spent.
   */
  async scorePhoto(photoId: string): Promise<ScoreResult> {
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
      include: {
        submission: { include: { campaign: true } },
      },
    });
    if (!photo) throw new NotFoundException(`photo not found: ${photoId}`);

    const { submission } = photo;
    const { campaign } = submission;

    // Mark the photo SCORING up front so a stalled job is visible in the UI.
    await this.prisma.photo.update({
      where: { id: photo.id },
      data: { status: PhotoStatus.SCORING },
    });

    // ----- resolve the rubric (latest version for campaign + fixtureKey) -----
    const rubric = await this.prisma.rubric.findFirst({
      where: { campaignId: campaign.id, fixtureKey: photo.fixtureKey },
      orderBy: { version: 'desc' },
    });
    if (!rubric) {
      throw new NotFoundException(
        `no rubric for campaign ${campaign.key} fixture "${photo.fixtureKey}"`,
      );
    }

    const criteria = this.parseCriteria(rubric.criteria, rubric.id);
    const rule = RollupRuleSchema.parse(rubric.rollupRule ?? {}) as RollupRule;
    // Stable, human-readable stamp: "storefront.MSP2-2026.v1". Lets any verdict
    // be traced back to the exact rubric version that produced it.
    const rubricVersion = `${rubric.fixtureKey}.${campaign.key}.v${rubric.version}`;

    // ----- load + normalise the image (and optional reference) ---------------
    const image = await this.loadImage(photo.storageKey);
    const reference = rubric.referenceKey
      ? await this.loadImage(rubric.referenceKey).catch((err) => {
          // A missing reference shouldn't sink the whole score — log and grade
          // without it (the rubric text still stands on its own).
          this.logger.warn(
            `reference ${rubric.referenceKey} unreadable for rubric ${rubric.id}: ${errMsg(err)} — grading without it`,
          );
          return undefined;
        })
      : undefined;

    // ----- call the model ----------------------------------------------------
    const raw = await this.vision.score(image, criteria, reference);

    // ----- floor low confidence, then roll up -------------------------------
    const floored = applyConfidenceFloor(raw, this.confidenceFloor);
    const result = fixtureRollup(floored, criteria, {
      modelId: this.vision.modelId,
      promptVersion: PROMPT_VERSION,
      rubricVersion,
      rule,
    });

    // ----- persist the stamped verdict + flip the photo to SCORED -----------
    await this.persist(photo.id, rubric.id, result);

    this.logger.log(
      `scored photo ${photo.id} (${photo.fixtureKey}) → ${result.overall}` +
        `${result.needsReview ? ' [needs_review]' : ''} ` +
        `conf=${result.confidence.toFixed(2)} rubric=${rubricVersion}`,
    );
    return result;
  }

  // ----- internals ---------------------------------------------------------

  private parseCriteria(json: Prisma.JsonValue, rubricId: string): Criterion[] {
    const parsed = CriteriaSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `rubric ${rubricId} has invalid criteria JSON: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  /**
   * Read bytes for a storage key and normalise them through sharp into a clean
   * JPEG the vision API will accept: auto-rotated by EXIF, longest edge capped,
   * metadata stripped (we never forward EXIF GPS/owner data to the model).
   */
  private async loadImage(storageKey: string): Promise<ImageInput> {
    const original = await this.storage.getBytes(storageKey);
    try {
      const bytes = await sharp(original)
        .rotate() // apply EXIF orientation, then drop it
        .resize({
          width: this.maxEdge,
          height: this.maxEdge,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 82 })
        .toBuffer();
      return { bytes, mediaType: 'image/jpeg' };
    } catch (err) {
      // A corrupt upload is a permanent failure for this photo — surface it so
      // the worker stops retrying a file sharp can never decode.
      throw new Error(
        `could not decode image at ${storageKey}: ${errMsg(err)}`,
      );
    }
  }

  /** Upsert the Verdict (unique per photo) and flip the Photo to SCORED in one
   *  transaction so a reader never sees SCORED without a verdict, or vice-versa. */
  private async persist(
    photoId: string,
    rubricId: string,
    result: ScoreResult,
  ): Promise<void> {
    const overall = toPrismaOverall(result.overall);
    // results is plain JSON-safe data (ids, enums, numbers, strings).
    const results = result.results as unknown as Prisma.InputJsonValue;

    await this.prisma.$transaction([
      this.prisma.verdict.upsert({
        where: { photoId },
        create: {
          photoId,
          rubricId,
          overall,
          needsReview: result.needsReview,
          confidence: result.confidence,
          modelId: result.modelId,
          promptVersion: result.promptVersion,
          results,
        },
        update: {
          rubricId,
          overall,
          needsReview: result.needsReview,
          confidence: result.confidence,
          modelId: result.modelId,
          promptVersion: result.promptVersion,
          results,
        },
      }),
      this.prisma.photo.update({
        where: { id: photoId },
        data: { status: PhotoStatus.SCORED },
      }),
    ]);
  }
}

// ----- module-level helpers (pure) -----------------------------------------

/** Map the scoring core's lowercase Overall onto the Prisma enum. */
function toPrismaOverall(overall: TypesOverall): PrismaOverall {
  switch (overall) {
    case 'perfect':
      return PrismaOverall.PERFECT;
    case 'good':
      return PrismaOverall.GOOD;
    case 'not_good':
      return PrismaOverall.NOT_GOOD;
    case 'needs_review':
      return PrismaOverall.NEEDS_REVIEW;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
