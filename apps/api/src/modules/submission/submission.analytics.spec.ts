import { describe, it, expect, vi } from 'vitest';
import { CaptureVerdict } from '@prisma/client';

import { SubmissionService } from './submission.service';

// =============================================================================
// Date-windowed analytics contract — MIGRATED to the live FixtureCapture pipeline.
//
// buildStoreScore / campaignQueue / campaignTurnaround now source compliance from
// the canonical floor-plan loop (applicable Placements as the EXPECTED fixtures +
// FixtureCapture per fixture for the EFFECTIVE verdict), NOT the legacy
// Submission/Photo/Verdict pipeline. These tests mock `placement` + `fixtureCapture`
// and assert the SAME behaviours against the new source:
//   1. buildStoreScore filters captures by the OPTIONAL window — a capture
//      uploaded OUTSIDE the window is excluded, so its fixture reads not_submitted;
//      with NO window the same capture scores (unchanged all-time).
//   2. A FixtureCapture-ONLY store (no Submission row at all) now produces a
//      non-empty StoreScore — the core bug this migration fixes.
//   3. campaignTurnaround surfaces the unreviewed backlog (awaitingReview +
//      oldestPendingAgeMinutes) from unreviewed NEEDS_REVIEW captures.
//
// Prisma is mocked at the query boundary so the suite needs no live DB.
// =============================================================================

const ORG = 'org_1';
const STORE = 'store_1';
const CAMPAIGN = 'campaign_1';
const FIXTURE = 'fixture_storefront';

const STORE_ROW = {
  id: STORE,
  name: 'Bondi',
  brand: 'Myer',
  region: 'NSW',
  areaManager: 'A. Manager',
  storeType: 'flagship',
};
const CAMPAIGN_ROW = { id: CAMPAIGN, key: 'MSP2-2026', name: 'MSP2' };

// One applicable placement = the store's single EXPECTED fixture.
const PLACEMENTS = [
  {
    fixtureId: FIXTURE,
    label: 'Storefront',
    applicable: true,
    order: 0,
    fixture: { name: 'Storefront' },
  },
];

const IN_WINDOW = new Date('2026-06-03T10:00:00.000Z');
const OUT_OF_WINDOW = new Date('2026-05-01T10:00:00.000Z');

/**
 * A Prisma double whose FixtureCapture has a PASS verdict + photo uploaded at the
 * given time. The service applies the window in-memory (uploadedAt/scoredAt), so
 * the mock just returns the row unconditionally and the service decides.
 */
function makePrisma(captureUploadedAt: Date) {
  const capture = {
    fixtureId: FIXTURE,
    storageKey: 'captures/x.jpg',
    verdict: CaptureVerdict.PASS,
    overrideVerdict: null,
    uploadedAt: captureUploadedAt,
    scoredAt: captureUploadedAt,
  };
  return {
    store: {
      findFirst: vi.fn(async () => STORE_ROW),
      findMany: vi.fn(async () => [STORE_ROW]),
    },
    campaign: { findFirst: vi.fn(async () => CAMPAIGN_ROW) },
    placement: { findMany: vi.fn(async () => PLACEMENTS) },
    fixtureCapture: { findMany: vi.fn(async () => [capture]) },
    // rubricVersionsForCampaign reads the campaign's rubrics for the stamp.
    rubric: {
      findMany: vi.fn(async () => [
        { fixtureKey: 'storefront', version: 2, active: true },
      ]),
    },
  };
}

function makeService(prisma: ReturnType<typeof makePrisma>) {
  const storage = { signedGetUrl: vi.fn(() => 'signed://x') };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new SubmissionService(prisma as any, storage as any);
}

describe('date-windowed buildStoreScore (via storeScore / queue) — FixtureCapture source', () => {
  it('scores the fixture when NO window is passed (all-time, unchanged)', async () => {
    const prisma = makePrisma(IN_WINDOW);
    const service = makeService(prisma);
    const score = await service.storeScore(ORG, STORE, CAMPAIGN);
    const fixture = score.fixtures.find((f) => f.fixture === FIXTURE);
    expect(fixture?.status).toBe('scored');
    // PASS → good (the CaptureVerdict→Overall mapping the rollup expects).
    expect(fixture?.overall).toBe('good');
    // The capture verdict was sourced from FixtureCapture, not the legacy pipeline.
    expect(prisma.fixtureCapture.findMany).toHaveBeenCalled();
  });

  it('stamps rubricVersions from the campaign’s active rubric versions', async () => {
    const prisma = makePrisma(IN_WINDOW);
    const service = makeService(prisma);
    const score = await service.storeScore(ORG, STORE, CAMPAIGN);
    // active version 2 of "storefront" in campaign MSP2-2026.
    expect(score.rubricVersions).toEqual(['storefront.MSP2-2026.v2']);
  });

  it('excludes a capture uploaded BEFORE the window → fixture is not_submitted', async () => {
    const prisma = makePrisma(OUT_OF_WINDOW);
    const service = makeService(prisma);
    const window = {
      from: new Date('2026-06-01T00:00:00.000Z'),
      to: new Date('2026-06-30T23:59:59.000Z'),
    };
    const queue = await service.campaignQueue(ORG, CAMPAIGN, window);
    const store = queue.stores.find((s) => s.storeId === STORE);
    const fixture = store?.fixtures.find((f) => f.fixture === FIXTURE);
    expect(fixture?.status).toBe('not_submitted');
  });

  it('includes a capture uploaded INSIDE the window → fixture scores', async () => {
    const prisma = makePrisma(IN_WINDOW);
    const service = makeService(prisma);
    const window = {
      from: new Date('2026-06-01T00:00:00.000Z'),
      to: new Date('2026-06-30T23:59:59.000Z'),
    };
    const queue = await service.campaignQueue(ORG, CAMPAIGN, window);
    const store = queue.stores.find((s) => s.storeId === STORE);
    const fixture = store?.fixtures.find((f) => f.fixture === FIXTURE);
    expect(fixture?.status).toBe('scored');
    expect(fixture?.overall).toBe('good');
  });
});

describe('FixtureCapture-only store (no Submission row) — the core bug fixed', () => {
  it('produces a non-empty StoreScore for a store doing all work on the floor plan', async () => {
    // This prisma double has NO submission/photo/verdict surface at all — exactly
    // a store that does everything via the floor-plan loop. Before the migration
    // buildStoreScore read Submission and this store was invisible to the queue.
    const capture = {
      fixtureId: FIXTURE,
      storageKey: 'captures/x.jpg',
      verdict: CaptureVerdict.PASS,
      overrideVerdict: null,
      uploadedAt: IN_WINDOW,
      scoredAt: IN_WINDOW,
    };
    const prisma = {
      store: {
        findFirst: vi.fn(async () => STORE_ROW),
        findMany: vi.fn(async () => [STORE_ROW]),
      },
      campaign: { findFirst: vi.fn(async () => CAMPAIGN_ROW) },
      placement: { findMany: vi.fn(async () => PLACEMENTS) },
      fixtureCapture: { findMany: vi.fn(async () => [capture]) },
      rubric: { findMany: vi.fn(async () => []) },
    };
    const service = makeService(prisma as unknown as ReturnType<typeof makePrisma>);

    const score = await service.storeScore(ORG, STORE, CAMPAIGN);
    // The store appears with a real score (not skipped / empty).
    expect(score.storeId).toBe(STORE);
    expect(score.fixtures).toHaveLength(1);
    expect(score.fixtures[0]?.status).toBe('scored');
    expect(score.submitted).toBe(1);
    expect(score.expected).toBe(1);
    // PASS-only store rolls up to a "good" store band (no perfect notion on captures).
    expect(score.overall).toBe('good');
    // And it shows up in the campaign queue (the reviewer/leaderboard source).
    const queue = await service.campaignQueue(ORG, CAMPAIGN);
    expect(queue.stores.find((s) => s.storeId === STORE)).toBeDefined();
    expect(queue.skipped).toHaveLength(0);
  });

  it('maps FAIL→not_good and an override beats the AI verdict', async () => {
    // Capture AI-scored FAIL but a reviewer OVERRODE to PASS — the effective
    // verdict (override) wins, so the fixture rolls up as good.
    const capture = {
      fixtureId: FIXTURE,
      storageKey: 'captures/x.jpg',
      verdict: CaptureVerdict.FAIL,
      overrideVerdict: CaptureVerdict.PASS,
      uploadedAt: IN_WINDOW,
      scoredAt: IN_WINDOW,
    };
    const prisma = {
      store: {
        findFirst: vi.fn(async () => STORE_ROW),
        findMany: vi.fn(async () => [STORE_ROW]),
      },
      campaign: { findFirst: vi.fn(async () => CAMPAIGN_ROW) },
      placement: { findMany: vi.fn(async () => PLACEMENTS) },
      fixtureCapture: { findMany: vi.fn(async () => [capture]) },
      rubric: { findMany: vi.fn(async () => []) },
    };
    const service = makeService(prisma as unknown as ReturnType<typeof makePrisma>);
    const score = await service.storeScore(ORG, STORE, CAMPAIGN);
    expect(score.fixtures[0]?.overall).toBe('good');
    expect(score.overall).toBe('good');
  });
});

describe('campaignTurnaround unreviewed backlog — FixtureCapture source', () => {
  function makeTurnaroundPrisma(
    captures: {
      verdict: CaptureVerdict | null;
      overrideVerdict?: CaptureVerdict | null;
      uploadedAt?: Date | null;
      scoredAt?: Date | null;
      reviewedAt?: Date | null;
    }[],
  ) {
    return {
      campaign: { findFirst: vi.fn(async () => CAMPAIGN_ROW) },
      fixtureCapture: {
        findMany: vi.fn(async () =>
          captures.map((c) => ({
            storeId: STORE,
            verdict: c.verdict,
            overrideVerdict: c.overrideVerdict ?? null,
            uploadedAt: c.uploadedAt ?? null,
            scoredAt: c.scoredAt ?? null,
            reviewedAt: c.reviewedAt ?? null,
            store: { name: 'Bondi' },
          })),
        ),
      },
    };
  }

  it('counts unreviewed NEEDS_REVIEW captures as awaitingReview + reports the oldest age', async () => {
    const now = Date.now();
    const prisma = makeTurnaroundPrisma([
      // A reviewed capture (uploaded 90m ago, reviewed 60m ago) → turnaround 30m.
      {
        verdict: CaptureVerdict.PASS,
        uploadedAt: new Date(now - 90 * 60 * 1000),
        reviewedAt: new Date(now - 60 * 60 * 1000),
      },
      // Two unreviewed NEEDS_REVIEW captures → the backlog.
      {
        verdict: CaptureVerdict.NEEDS_REVIEW,
        uploadedAt: new Date(now - 120 * 60 * 1000), // 2h old
      },
      {
        verdict: CaptureVerdict.NEEDS_REVIEW,
        uploadedAt: new Date(now - 30 * 60 * 1000), // 30m old
      },
    ]);
    const service = makeService(prisma as unknown as ReturnType<typeof makePrisma>);
    const t = await service.campaignTurnaround(ORG, CAMPAIGN);
    expect(t.reviewedCount).toBe(1);
    expect(t.awaitingReview).toBe(2);
    // oldest pending ≈ 120 minutes.
    expect(t.oldestPendingAgeMinutes).toBeGreaterThanOrEqual(119);
    expect(t.oldestPendingAgeMinutes).toBeLessThanOrEqual(121);
    // turnaround of the one reviewed capture ≈ 30 minutes.
    expect(t.avgReviewMinutes).toBeGreaterThanOrEqual(29);
    expect(t.avgReviewMinutes).toBeLessThanOrEqual(31);
  });

  it('an effective-verdict override that is NEEDS_REVIEW still counts as backlog', async () => {
    const now = Date.now();
    const prisma = makeTurnaroundPrisma([
      // AI said PASS, reviewer flagged NEEDS_REVIEW but hasn't decided (no reviewedAt)
      // — effective = NEEDS_REVIEW, still waiting.
      {
        verdict: CaptureVerdict.PASS,
        overrideVerdict: CaptureVerdict.NEEDS_REVIEW,
        uploadedAt: new Date(now - 45 * 60 * 1000),
      },
    ]);
    const service = makeService(prisma as unknown as ReturnType<typeof makePrisma>);
    const t = await service.campaignTurnaround(ORG, CAMPAIGN);
    expect(t.awaitingReview).toBe(1);
  });

  it('counts an override that differs from the AI verdict as a revision', async () => {
    const now = Date.now();
    const prisma = makeTurnaroundPrisma([
      // Reviewed + override differs from AI verdict → a revision (rework).
      {
        verdict: CaptureVerdict.FAIL,
        overrideVerdict: CaptureVerdict.PASS,
        uploadedAt: new Date(now - 60 * 60 * 1000),
        reviewedAt: new Date(now - 30 * 60 * 1000),
      },
      // Reviewed + override matches AI verdict → a confirm, NOT a revision.
      {
        verdict: CaptureVerdict.PASS,
        overrideVerdict: CaptureVerdict.PASS,
        uploadedAt: new Date(now - 60 * 60 * 1000),
        reviewedAt: new Date(now - 30 * 60 * 1000),
      },
    ]);
    const service = makeService(prisma as unknown as ReturnType<typeof makePrisma>);
    const t = await service.campaignTurnaround(ORG, CAMPAIGN);
    expect(t.reviewedCount).toBe(2);
    expect(t.revisionCount).toBe(1);
    expect(t.mostRevised[0]?.storeId).toBe(STORE);
    expect(t.mostRevised[0]?.revisions).toBe(1);
  });

  it('reports an empty backlog as 0 / null', async () => {
    const prisma = makeTurnaroundPrisma([]);
    const service = makeService(prisma as unknown as ReturnType<typeof makePrisma>);
    const t = await service.campaignTurnaround(ORG, CAMPAIGN);
    expect(t.awaitingReview).toBe(0);
    expect(t.oldestPendingAgeMinutes).toBeNull();
    expect(t.reviewedCount).toBe(0);
  });
});

describe('campaignSales — the leaderboard primary (sales) signal', () => {
  const STORE_A = { id: 'store_A', name: 'Bondi', brand: 'Myer', region: 'NSW' };
  const STORE_B = {
    id: 'store_B',
    name: 'Chadstone',
    brand: 'Myer',
    region: 'VIC',
  };

  /**
   * A Prisma double for sales: two ACTIVE stores, and a groupBy that returns a
   * revenue/units sum keyed by storeId. `grouped` lets a test control which
   * stores have sales (a store absent from grouped must roll up to 0).
   */
  type GroupByArgs = {
    where: {
      campaignId: string;
      soldOn?: { gte?: Date; lte?: Date };
    };
  };

  function makeSalesPrisma(
    grouped: { storeId: string; units: number; revenue: number }[],
  ) {
    const groupBy = vi.fn(
      async (_args: GroupByArgs) =>
        grouped.map((g) => ({
          storeId: g.storeId,
          _sum: { units: g.units, revenue: g.revenue },
        })),
    );
    const prisma = {
      campaign: { findFirst: vi.fn(async () => CAMPAIGN_ROW) },
      store: { findMany: vi.fn(async () => [STORE_A, STORE_B]) },
      salesEntry: { groupBy },
    };
    return { prisma, groupBy };
  }

  it('returns every ACTIVE store, ranking sums by revenue (zero-sales stores included)', async () => {
    const { prisma } = makeSalesPrisma([
      { storeId: 'store_A', units: 12, revenue: 4800 },
      // store_B has no sales row → must still appear with 0/0.
    ]);
    const service = makeService(prisma as unknown as ReturnType<typeof makePrisma>);
    const rows = await service.campaignSales(ORG, CAMPAIGN);

    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.storeId === 'store_A');
    const b = rows.find((r) => r.storeId === 'store_B');
    expect(a).toMatchObject({ units: 12, revenue: 4800, region: 'NSW' });
    expect(b).toMatchObject({ units: 0, revenue: 0, region: 'VIC' });
  });

  it('passes a soldOn date window into the groupBy where-clause', async () => {
    const { prisma, groupBy } = makeSalesPrisma([]);
    const service = makeService(prisma as unknown as ReturnType<typeof makePrisma>);
    const window = {
      from: new Date('2026-06-01T00:00:00.000Z'),
      to: new Date('2026-06-30T23:59:59.000Z'),
    };
    await service.campaignSales(ORG, CAMPAIGN, window);

    const arg = groupBy.mock.calls[0]?.[0];
    expect(arg?.where.campaignId).toBe(CAMPAIGN);
    expect(arg?.where.soldOn?.gte).toEqual(window.from);
    expect(arg?.where.soldOn?.lte).toEqual(window.to);
  });

  it('omits the soldOn filter entirely for the all-time (no window) path', async () => {
    const { prisma, groupBy } = makeSalesPrisma([]);
    const service = makeService(prisma as unknown as ReturnType<typeof makePrisma>);
    await service.campaignSales(ORG, CAMPAIGN);

    const arg = groupBy.mock.calls[0]?.[0];
    expect(arg?.where.soldOn).toBeUndefined();
  });
});
