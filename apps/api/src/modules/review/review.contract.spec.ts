import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewAction as DbReviewAction } from '@prisma/client';

import { CreateReviewSchema } from './review.dto';
import { ReviewService } from './review.service';

// =============================================================================
// Reviewer-action contract round-trip.
//
// Fix for "Console reviewer OVERRIDE permanently 400s": the console's
// ReviewActions.tsx posts exactly these shapes —
//   CONFIRM  : { action, note? }
//   OVERRIDE : { action, overall, note? }   (whole-fixture band)
//   ESCALATE : { action, note? }
// — and the legacy DTO only accepted a per-criterion OVERRIDE. This suite asserts
// each shape (a) survives the .strict() DTO and (b) drives ReviewService to
// persist the right Review row, so the contract is verified end-to-end without a
// live DB (Prisma is mocked at the create/update boundary).
//
// A per-criterion OVERRIDE (the API-only form) is covered too, to prove both
// override shapes coexist.
// =============================================================================

const ORG = 'org_1';
const REVIEWER = 'user_reviewer';
const VERDICT_ID = 'verdict_1';

const RUBRIC = {
  fixtureKey: 'storefront',
  version: 1,
  campaign: { key: 'MSP2-2026' },
  criteria: [
    { id: 'present', kind: 'presence', critical: true, text: 'built' },
    { id: 'hero', kind: 'aesthetic', critical: false, text: 'hero at back' },
  ],
  rollupRule: {
    not_good_if_any_critical_fails: true,
    good_if_only_noncritical_fails: true,
  },
};

function makeVerdict() {
  return {
    id: VERDICT_ID,
    overall: 'NEEDS_REVIEW',
    needsReview: true,
    confidence: 0.5,
    modelId: 'm1',
    promptVersion: 'p1',
    results: [
      { id: 'present', verdict: 'pass', confidence: 0.9, evidence: '' },
      { id: 'hero', verdict: 'unsure', confidence: 0.4, evidence: '' },
    ],
    rubric: RUBRIC,
  };
}

/**
 * A Prisma double that captures every Review row created and the Verdict data
 * any override writes. $transaction runs the callback with the same double (the
 * service only uses tx.review/tx.verdict).
 */
function makePrisma() {
  const reviewsCreated: Array<Record<string, unknown>> = [];
  const verdictUpdates: Array<Record<string, unknown>> = [];
  const tx = {
    review: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `review_${reviewsCreated.length + 1}`, ...data };
        reviewsCreated.push(row);
        return row;
      }),
    },
    verdict: {
      update: vi.fn(
        async ({ data }: { data: Record<string, unknown> }) => {
          verdictUpdates.push(data);
          return {
            id: VERDICT_ID,
            overall: data.overall ?? 'NEEDS_REVIEW',
            needsReview: data.needsReview ?? true,
            confidence: data.confidence ?? 0.5,
            results: data.results ?? makeVerdict().results,
          };
        },
      ),
    },
  };
  const prisma = {
    verdict: {
      findFirst: vi.fn(async () => makeVerdict()),
      update: tx.verdict.update,
    },
    review: { create: tx.review.create },
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  return { prisma, reviewsCreated, verdictUpdates };
}

function parse(body: unknown) {
  // Mirrors the controller's ZodValidationPipe: a 400 here IS the bug we fixed.
  return CreateReviewSchema.parse(body);
}

describe('reviewer action contract (UI → DTO → ReviewService)', () => {
  let prisma: ReturnType<typeof makePrisma>['prisma'];
  let reviewsCreated: ReturnType<typeof makePrisma>['reviewsCreated'];
  let verdictUpdates: ReturnType<typeof makePrisma>['verdictUpdates'];
  let service: ReviewService;

  beforeEach(() => {
    ({ prisma, reviewsCreated, verdictUpdates } = makePrisma());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new ReviewService(prisma as any);
  });

  it('CONFIRM with no note validates and persists an audit-only Review', async () => {
    const input = parse({ action: 'CONFIRM' });
    const res = await service.review(ORG, REVIEWER, VERDICT_ID, input);
    expect(res.review).toBeDefined();
    expect(reviewsCreated).toHaveLength(1);
    expect(reviewsCreated[0]).toMatchObject({
      action: DbReviewAction.CONFIRM,
      verdictId: VERDICT_ID,
      reviewerId: REVIEWER,
      reason: null,
    });
    // Audit-only — no verdict mutation.
    expect(verdictUpdates).toHaveLength(0);
  });

  it('CONFIRM carrying a note validates and persists the note as reason', async () => {
    const input = parse({ action: 'CONFIRM', note: 'looks right to me' });
    await service.review(ORG, REVIEWER, VERDICT_ID, input);
    expect(reviewsCreated[0]).toMatchObject({
      action: DbReviewAction.CONFIRM,
      reason: 'looks right to me',
    });
  });

  it('ESCALATE with a note validates and persists an audit Review', async () => {
    const input = parse({ action: 'ESCALATE', note: 'needs a second look' });
    await service.review(ORG, REVIEWER, VERDICT_ID, input);
    expect(reviewsCreated[0]).toMatchObject({
      action: DbReviewAction.ESCALATE,
      reason: 'needs a second look',
    });
    expect(verdictUpdates).toHaveLength(0);
  });

  it('OVERRIDE (whole-fixture band) — the exact console shape — validates and sets the band', async () => {
    // ReviewActions.tsx sends { action, overall, note } for OVERRIDE.
    const input = parse({ action: 'OVERRIDE', overall: 'good', note: 'storefront fine' });
    const res = (await service.review(ORG, REVIEWER, VERDICT_ID, input)) as {
      review: unknown;
      verdict: { overall: string };
    };

    // A Review audit row capturing from→to band.
    expect(reviewsCreated[0]).toMatchObject({
      action: DbReviewAction.OVERRIDE,
      criterionId: null,
      fromVerdict: 'needs_review',
      toVerdict: 'good',
      reason: 'storefront fine',
      reviewerId: REVIEWER,
    });
    // The verdict's overall is set to the chosen band, needsReview cleared, and
    // the reviewer stamped for audit.
    expect(verdictUpdates[0]).toMatchObject({
      overall: 'GOOD',
      needsReview: false,
      lastReviewedById: REVIEWER,
    });
    expect(res.verdict?.overall).toBe('good');
  });

  it('OVERRIDE without a note still validates (note is optional)', async () => {
    const input = parse({ action: 'OVERRIDE', overall: 'not_good' });
    await service.review(ORG, REVIEWER, VERDICT_ID, input);
    expect(reviewsCreated[0]).toMatchObject({
      action: DbReviewAction.OVERRIDE,
      toVerdict: 'not_good',
      reason: null,
    });
    expect(verdictUpdates[0]).toMatchObject({ overall: 'NOT_GOOD' });
  });

  it('OVERRIDE (per-criterion) — the API form — validates and recomputes the rollup', async () => {
    const input = parse({
      action: 'OVERRIDE',
      criterionId: 'hero',
      toVerdict: 'pass',
      reason: 'hero is clearly at the back',
    });
    await service.review(ORG, REVIEWER, VERDICT_ID, input);
    expect(reviewsCreated[0]).toMatchObject({
      action: DbReviewAction.OVERRIDE,
      criterionId: 'hero',
      toVerdict: 'pass',
    });
    // Flipping the only unsure criterion to pass → no more escalation → perfect.
    expect(verdictUpdates[0]).toMatchObject({
      overall: 'PERFECT',
      lastReviewedById: REVIEWER,
    });
  });

  it('OVERRIDE with neither band nor criterion is rejected by the DTO (a 400)', () => {
    expect(() => parse({ action: 'OVERRIDE', note: 'oops' })).toThrow();
  });

  it('OVERRIDE with both band and criterion is rejected (mutually exclusive)', () => {
    expect(() =>
      parse({
        action: 'OVERRIDE',
        overall: 'good',
        criterionId: 'hero',
        toVerdict: 'pass',
      }),
    ).toThrow();
  });
});
