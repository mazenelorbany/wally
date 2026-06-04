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
  /** Set for STORE_MANAGER users — the store whose checklist they capture. */
  storeId?: string | null;
}

/* -------------------------------------------------------------------------- */
/* CREATE GUIDE — VM guide authoring (floor plans, guide fixtures, catalog)    */
/* -------------------------------------------------------------------------- */

/** The physical kinds of fixture a store can carry. */
export type FixtureKind =
  | "bay"
  | "table"
  | "stand"
  | "window"
  | "dais"
  | "trolley";

/** A fixture in the org's library (the reusable catalog of fixture types). */
export interface Fixture {
  id: string;
  name: string;
  kind: FixtureKind;
}

/**
 * A fixture positioned on a store's floor plan for one campaign's guide.
 * Geometry (`x`,`y`,`w`,`h`) is in floor-plan units; `rotation` in degrees.
 */
export interface PlacedFixture {
  id: string;
  fixtureId: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  /** Whether this fixture applies to the store for this campaign. */
  applicable: boolean;
  kind: FixtureKind;
}

/** A store's floor plan for one campaign: the placed fixtures laid out. */
export interface FloorPlan {
  storeId: string;
  storeName: string;
  campaignId: string;
  campaignKey: string;
  placements: PlacedFixture[];
}

/** A product from the org's merchandising catalog. */
export interface ProductDto {
  id: string;
  sku: string;
  name: string;
  brand?: string;
  category?: string;
  color?: string;
  imageUrl?: string;
}

/** One row of merchandise on a guide-fixture's planogram. */
export interface MerchandiseRow {
  row: string;
  products: ProductDto[];
}

/** A "what good looks like" reference image on a guide-fixture. */
export interface GuideFixtureExampleImage {
  id: string;
  /** Signed, time-limited URL — never the raw storage key. */
  url: string;
  caption?: string;
  bestInClass: boolean;
}

/**
 * One fixture's instruction sheet within a guide: VM notes, reference
 * images, and the merchandise planogram (products laid out by row).
 */
export interface GuideFixtureDetail {
  fixtureId: string;
  fixtureName: string;
  kind: FixtureKind;
  notes: string;
  exampleImages: GuideFixtureExampleImage[];
  merchandise: MerchandiseRow[];
}
