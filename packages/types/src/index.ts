// Shared contracts between the API and the web app. Pure types — no runtime.

export type CriterionKind = "presence" | "aesthetic";
export type VerdictValue = "pass" | "fail" | "unsure";
export type Overall = "perfect" | "good" | "not_good" | "needs_review";
export type FixtureStatus = "scored" | "not_applicable" | "not_submitted";
export type StoreBand = Overall | "incomplete";

/** One rubric criterion (stored in Rubric.criteria JSON). */
export interface Criterion {
  id: string;
  kind: CriterionKind;
  critical: boolean;
  text: string;
}

export interface RollupRule {
  not_good_if_any_critical_fails: boolean;
  good_if_only_noncritical_fails: boolean;
}

export interface Rubric {
  id: string;
  fixtureKey: string;
  campaignKey: string;
  version: number;
  criteria: Criterion[];
  rollupRule: RollupRule;
  referenceKey?: string | null;
  /** Stable stamp, e.g. "storefront.MSP2-2026.v1". */
  rubricVersion: string;
}

/** One criterion graded against one photo (stored in Verdict.results JSON). */
export interface CriterionResult {
  id: string;
  verdict: VerdictValue;
  confidence: number;
  evidence: string;
}

export interface Flag {
  id: string;
  kind: CriterionKind;
  text: string;
}

/** A scored photo. */
export interface ScoreResult {
  overall: Overall;
  needsReview: boolean;
  confidence: number;
  flags: Flag[];
  results: CriterionResult[];
  rubricVersion: string;
  modelId: string;
  promptVersion: string;
}

/** One fixture's place in a store's submission. */
export interface FixtureOutcome {
  fixture: string;
  label: string;
  status: FixtureStatus;
  overall?: Overall;
  photoId?: string;
}

/** Many fixtures rolled up into one store verdict. */
export interface StoreScore {
  storeId: string;
  storeName: string;
  campaignKey: string;
  overall: StoreBand;
  needsReview: boolean;
  submitted: number;
  expected: number;
  failed: string[];
  review: string[];
  missing: string[];
  notApplicable: string[];
  fixtures: FixtureOutcome[];
  rubricVersions: string[];
}

export type Role = "ADMIN" | "REVIEWER" | "STORE_MANAGER";
export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  role: Role;
  orgId: string;
}
