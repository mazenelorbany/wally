// Store-level rollup — many per-fixture outcomes → one store verdict.
// Ported from the Python POC (store.py). Escalation-first; applicability-aware.
import type { FixtureOutcome, StoreBand, StoreScore } from "@wally/types";

export class ApplicabilityError extends Error {}

export interface StoreRollupInput {
  storeId: string;
  storeName: string;
  campaignKey: string;
  fixtures: FixtureOutcome[];
  rubricVersions: string[];
}

export function storeRollup(input: StoreRollupInput): StoreScore {
  const { fixtures } = input;
  const notApplicable = fixtures
    .filter((f) => f.status === "not_applicable")
    .map((f) => f.fixture);
  const missing = fixtures
    .filter((f) => f.status === "not_submitted")
    .map((f) => f.fixture);
  const scored = fixtures.filter((f) => f.status === "scored");

  if (scored.length === 0 && missing.length === 0) {
    // Every fixture marked "don't have it" — nothing to grade. Fail loudly.
    throw new ApplicabilityError(
      `store ${input.storeId} has no applicable fixtures to grade`,
    );
  }

  const failed = scored
    .filter((f) => f.overall === "not_good")
    .map((f) => f.fixture);
  const review = scored
    .filter((f) => f.overall === "needs_review")
    .map((f) => f.fixture);
  const hasGood = scored.some((f) => f.overall === "good");

  let overall: StoreBand;
  let needsReview: boolean;
  if (scored.length === 0 && missing.length > 0) {
    overall = "incomplete";
    needsReview = true;
  } else if (missing.length || review.length) {
    overall = "needs_review";
    needsReview = true;
  } else if (failed.length) {
    overall = "not_good";
    needsReview = false;
  } else if (hasGood) {
    overall = "good";
    needsReview = false;
  } else {
    overall = "perfect";
    needsReview = false;
  }

  return {
    storeId: input.storeId,
    storeName: input.storeName,
    campaignKey: input.campaignKey,
    overall,
    needsReview,
    submitted: scored.length,
    expected: scored.length + missing.length,
    failed,
    review,
    missing,
    notApplicable,
    fixtures,
    rubricVersions: [...new Set(input.rubricVersions)].sort(),
  };
}
