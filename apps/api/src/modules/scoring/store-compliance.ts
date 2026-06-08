// =============================================================================
// Store-compliance source — the SHARED bridge from the live FixtureCapture loop
// to the core storeRollup.
// =============================================================================
//
// The floor-plan compliance loop (ManagerService.compliance + uploadFixturePhoto)
// is the CANONICAL pipeline: a store's expected fixtures are its APPLICABLE
// Placements, and each fixture's verdict is its FixtureCapture's EFFECTIVE verdict
// (`overrideVerdict ?? verdict`). This helper turns that exact pair —
// (applicable Placements, FixtureCapture per fixture) — into the FixtureOutcome[]
// the pure storeRollup() consumes, so the reviewer queue / leaderboard / insights
// / snapshot read the SAME source the manager floor map writes to.
//
// It is deliberately a pure function over a minimal Prisma-like surface (no
// NestJS), so both SubmissionService.buildStoreScore and ManagerService can call
// it and never diverge, and so it is trivially unit-testable with a mock Prisma.
//
// CaptureVerdict (the AI/human verdict) → core Overall the rollup expects:
//   PASS         → good
//   FAIL         → not_good
//   NEEDS_REVIEW → needs_review
// (the rollup core has no notion of "perfect"; a capture verdict only carries the
// three bands, so PASS maps to the rollup-equivalent "good").
//
// Outcome status per applicable placement:
//   scored        → the capture has a scored EFFECTIVE verdict
//   not_submitted → no capture, or a capture with no photo (no storageKey)
//   not_applicable→ placement.applicable = false
//
// A `DateWindow` (optional) bounds which captures count: only captures whose
// `uploadedAt` (falling back to `scoredAt`) sits within the window are read as a
// verdict; outside the window the fixture reads not_submitted — mirroring the
// legacy photo-window behaviour. Absent window = all-time (unchanged).
// =============================================================================

import { CaptureVerdict } from '@prisma/client';
import type { FixtureOutcome, FixtureStatus, Overall } from '@wally/types';

/** Optional inclusive analytics window over a capture's upload/score time. */
export interface ComplianceWindow {
  from?: Date;
  to?: Date;
}

/** A placement row, narrowed to what the rollup needs (its fixture meta + applicability). */
export interface PlacementRow {
  fixtureId: string;
  label: string;
  applicable: boolean;
  order: number;
  fixture: { name: string };
}

/** A FixtureCapture row, narrowed to what the verdict mapping needs. */
export interface CaptureRow {
  fixtureId: string;
  storageKey: string | null;
  verdict: CaptureVerdict | null;
  overrideVerdict: CaptureVerdict | null;
  uploadedAt: Date | null;
  scoredAt: Date | null;
}

/**
 * The minimal Prisma surface this helper reads. The method args are typed as
 * `any` so the real (heavily-overloaded) Prisma delegate AND a hand-rolled test
 * double both satisfy it; the RETURN rows are the narrowed shapes above, which is
 * what actually matters for the rollup. The real `PrismaService` is structurally
 * compatible (its delegates return supersets of these rows).
 */
export interface ComplianceFinder {
  placement: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany(args: any): Promise<any[]>;
  };
  fixtureCapture: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany(args: any): Promise<any[]>;
  };
}

/** Map a capture verdict (PASS/FAIL/NEEDS_REVIEW) → the core Overall band. */
export function captureVerdictToOverall(v: CaptureVerdict): Overall {
  switch (v) {
    case CaptureVerdict.PASS:
      return 'good';
    case CaptureVerdict.FAIL:
      return 'not_good';
    case CaptureVerdict.NEEDS_REVIEW:
      return 'needs_review';
    default: {
      const _exhaustive: never = v;
      throw new Error(`unmapped CaptureVerdict: ${String(_exhaustive)}`);
    }
  }
}

/** The reference timestamp a window bounds: when the photo was uploaded, else scored. */
function captureTimestamp(c: CaptureRow): Date | null {
  return c.uploadedAt ?? c.scoredAt ?? null;
}

/** Is the capture inside the (optional) window? No window ⇒ always true. */
function inWindow(c: CaptureRow, window?: ComplianceWindow): boolean {
  if (!window || (!window.from && !window.to)) return true;
  const ts = captureTimestamp(c);
  // A capture with no timestamp can't be placed in a period — exclude it from a
  // windowed read (it reads as not_submitted for that period).
  if (!ts) return false;
  if (window.from && ts < window.from) return false;
  if (window.to && ts > window.to) return false;
  return true;
}

/** What this store's compliance source resolved to. */
export interface StoreComplianceOutcomes {
  /** One FixtureOutcome per placement (applicable + not_applicable), in placement order. */
  outcomes: FixtureOutcome[];
  /** Whether the store has ANY placement at all (empty ⇒ no floor plan configured). */
  hasPlacements: boolean;
}

/**
 * Build the FixtureOutcome[] for a (store, campaign) from its applicable
 * Placements (the EXPECTED fixtures) + the FixtureCapture per fixture (the
 * EFFECTIVE verdict), respecting an optional capture window.
 *
 * `fixtureKey` on each outcome is the stable fixtureId (the join key the capture
 * loop uses); `label` is `placement.label || fixture.name` — exactly the manager
 * compliance sheet's label rule.
 */
export async function loadStoreCompliance(
  prisma: ComplianceFinder,
  storeId: string,
  campaignId: string,
  window?: ComplianceWindow,
): Promise<StoreComplianceOutcomes> {
  const placements = (await prisma.placement.findMany({
    where: { storeId, campaignId },
    orderBy: [{ applicable: 'desc' }, { order: 'asc' }],
    include: { fixture: { select: { name: true } } },
  })) as PlacementRow[];

  if (placements.length === 0) {
    return { outcomes: [], hasPlacements: false };
  }

  const captures = (await prisma.fixtureCapture.findMany({
    where: { storeId, campaignId },
  })) as CaptureRow[];
  const captureByFixture = new Map(captures.map((c) => [c.fixtureId, c]));

  const outcomes: FixtureOutcome[] = placements.map((p) => {
    const label = p.label || p.fixture.name;
    if (!p.applicable) {
      return {
        fixture: p.fixtureId,
        label,
        status: 'not_applicable' as FixtureStatus,
      };
    }

    const capture = captureByFixture.get(p.fixtureId);
    // The EFFECTIVE verdict the floor map trusts: a human override beats the AI.
    const effective = capture?.overrideVerdict ?? capture?.verdict ?? null;

    // A capture counts as "scored" only when it has BOTH a photo and an effective
    // verdict AND falls inside the (optional) window. Otherwise the fixture is
    // still outstanding for this period.
    if (
      capture &&
      capture.storageKey &&
      effective &&
      inWindow(capture, window)
    ) {
      return {
        fixture: p.fixtureId,
        label,
        status: 'scored' as FixtureStatus,
        overall: captureVerdictToOverall(effective),
      };
    }

    return {
      fixture: p.fixtureId,
      label,
      status: 'not_submitted' as FixtureStatus,
    };
  });

  return { outcomes, hasPlacements: true };
}
