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
  /** The store's submission id for this campaign — needed to deep-link a
   *  fixture into the reviewer page (`/console/fixture/:photoId?submission=`). */
  submissionId?: string | null;
  /** Segmentation dimensions (null until set on the store). */
  region?: string | null;
  areaManager?: string | null;
  storeType?: string | null;
}

/**
 * Operational turnaround for a campaign — how fast verdicts get reviewed and
 * which stores need the most rework. Powers the Insights "who needs help" view.
 */
export interface ComplianceTurnaround {
  /** Verdicts that received a reviewer action. */
  reviewedCount: number;
  /** Mean minutes from AI verdict to first reviewer action (null if none). */
  avgReviewMinutes: number | null;
  /** Median minutes from verdict to review (null if none). */
  medianReviewMinutes: number | null;
  /** Reviews that overrode or escalated (i.e. required rework). */
  revisionCount: number;
  /** Stores with the most revisions, worst first. */
  mostRevised: { storeId: string; storeName: string; revisions: number }[];
}

/** One day's compliance rollup for a campaign — a point on the trend chart. */
export interface ComplianceTrendPoint {
  /** 'YYYY-MM-DD' (UTC). */
  dateKey: string;
  /** ISO timestamp the snapshot was captured. */
  capturedAt: string;
  storeCount: number;
  /** Stores in perfect + good. */
  onTrack: number;
  needsReview: number;
  /** Stores in not_good. */
  failing: number;
  incomplete: number;
  /** Fixtures photographed. */
  submitted: number;
  /** Applicable fixtures. */
  expected: number;
  /** Fixtures scored perfect/good. */
  passing: number;
}

/** A best-in-class store execution photo — an exemplar shown to other stores. */
export interface BestInClassItem {
  photoId: string;
  /** Signed, time-limited URL. */
  url: string;
  storeId: string;
  storeName: string;
  fixtureKey: string;
  overall?: Overall;
}

/** The current tenant (org settings). */
export interface OrgDto {
  id: string;
  name: string;
  slug: string;
}

/** A store in the org's roster (admin store-directory management). */
export interface StoreDto {
  id: string;
  name: string;
  brand: string;
  externalRef?: string | null;
  region?: string | null;
  areaManager?: string | null;
  storeType?: string | null;
}

export type Role = "ADMIN" | "REVIEWER" | "STORE_MANAGER" | "VIEWER";
export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  role: Role;
  orgId: string;
  /** Set for STORE_MANAGER users — the store whose checklist they capture. */
  storeId?: string | null;
}

/** A teammate in the org (admin user-management directory). */
export interface UserDto {
  id: string;
  email: string;
  name?: string | null;
  role: Role;
  storeId?: string | null;
  storeName?: string | null;
  /** Deactivated by an admin — blocked from signing in. */
  disabled: boolean;
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

/**
 * The two departments inside every Myer store. For this scope Wally is Myer
 * only, so a store is one floor plan split into these two departments — not two
 * separate stores. Every fixture belongs to one of them.
 */
export type Department = "The Custom Chef" | "The Cook Shop";

/** A fixture in the org's library (the reusable catalog of fixture types). */
export interface Fixture {
  id: string;
  name: string;
  kind: FixtureKind;
  /** Which Myer department this fixture belongs to (null until classified). */
  department?: Department | null;
}

/**
 * Where a library fixture is in use — shown in the delete dialog so an admin
 * sees the blast radius before archiving or deleting it.
 */
export interface FixtureUsage {
  /** Distinct stores that have this fixture placed on a floor plan. */
  stores: { id: string; name: string }[];
  storeCount: number;
  /** How many guides reference it. */
  guideCount: number;
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
  /** The Myer department this fixture sits in (Custom Chef / Cook Shop). */
  department?: Department | null;
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

/** A product placed on a guide-fixture, carrying its placement (Merchandise) id. */
export interface MerchandiseItem extends ProductDto {
  /** The Merchandise row id — needed to remove this placement. */
  merchandiseId: string;
}

/** A default product on a library fixture (its reusable starter set). */
export interface FixtureDefaultProduct extends ProductDto {
  /** The FixtureProduct row id — needed to remove this default. */
  fixtureProductId: string;
  /** Optional planogram row grouping. */
  row?: string | null;
}

/** One row of merchandise on a guide-fixture's planogram. */
export interface MerchandiseRow {
  row: string;
  products: MerchandiseItem[];
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
  /** The Fixture's id (its identity on the floor plan). */
  fixtureId: string;
  /** The GuideFixture row id — address for notes + add/remove merchandise. */
  guideFixtureId: string;
  fixtureName: string;
  kind: FixtureKind;
  notes: string;
  exampleImages: GuideFixtureExampleImage[];
  merchandise: MerchandiseRow[];
}

/** One execution image in the gallery (every store's submitted photos). */
export interface GalleryItem {
  id: string;
  /** Signed, time-limited URL. */
  url: string;
  storeId: string;
  storeName: string;
  fixtureKey: string;
  status: string;
  overall?: Overall;
  /** Reviewer-flagged exemplar (best-in-class). */
  bestInClass?: boolean;
}

/* -------------------------------------------------------------------------- */
/* MONEY MAP — revenue per fixture on the floor plan (illustrative for now)     */
/* -------------------------------------------------------------------------- */

/** A fixture on the money map: its floor-plan geometry + period sales. */
export interface MoneyFixture {
  id: string;
  fixtureId: string;
  label: string;
  kind: FixtureKind;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  revenue: number;
  units: number;
  /** Share of the store's total revenue, 0..100. */
  sharePct: number;
  /** The Myer department this fixture sits in (Custom Chef / Cook Shop). */
  department?: Department | null;
}

/** A store's floor plan recoloured by fixture revenue for a campaign period. */
export interface MoneyMap {
  storeId: string;
  storeName: string;
  campaignId: string;
  campaignKey: string;
  totalRevenue: number;
  totalUnits: number;
  /** Highest single-fixture revenue — for intensity scaling on the canvas. */
  maxRevenue: number;
  /** True while sales are sample data, not a live POS feed. */
  illustrative: boolean;
  fixtures: MoneyFixture[];
}

/* -------------------------------------------------------------------------- */
/* STORE MANAGER — the manager's own store: tasks, guide, products, sales      */
/* -------------------------------------------------------------------------- */

/** What an admin is asking a store (its manager) to do. */
export type TaskKind = "UPLOAD_PHOTO" | "LOG_SALES" | "GENERAL";
export type TaskStatus = "OPEN" | "DONE";

export interface TaskDto {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  title: string;
  body?: string | null;
  /** For UPLOAD_PHOTO: the fixture whose photo is wanted. */
  fixtureKey?: string | null;
  dueAt?: string | null;
  /** When the manager first opened it — null means unread (badge). */
  seenAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
}

/**
 * The store manager's landing payload: their store, the active campaign, their
 * open work, capture progress, and a sales snapshot. Drives the manager home +
 * the notification badge.
 */
export interface ManagerHome {
  storeId: string;
  storeName: string;
  campaignId: string;
  campaignKey: string;
  campaignName: string;
  department?: Department | null;
  openTasks: number;
  /** Tasks the manager hasn't opened yet — the red bell count. */
  unseenTasks: number;
  checklist: { total: number; done: number };
  sales: { totalRevenue: number; totalUnits: number; loggedProducts: number };
  tasks: TaskDto[];
}

/** One product line in the manager's sales log. */
export interface SalesLine {
  productId: string;
  sku: string;
  name: string;
  webTitle?: string | null;
  imageUrl?: string | null;
  range?: string | null;
  /** The per-unit price sales log against (salePrice, or rrp fallback). */
  unitPrice: number;
  /** Units currently logged for this product, this store, this campaign. */
  units: number;
  revenue: number;
}

/** The sales log grouped by the fixture the products sit on. */
export interface SalesFixtureGroup {
  fixtureId: string;
  label: string;
  kind: FixtureKind;
  department?: Department | null;
  units: number;
  revenue: number;
  lines: SalesLine[];
}

/** The whole sales log for a store × campaign (the manager's logging screen). */
export interface SalesLog {
  storeId: string;
  storeName: string;
  campaignId: string;
  campaignKey: string;
  /** The day this log is for ('YYYY-MM-DD', UTC). */
  soldOn: string;
  totalUnits: number;
  totalRevenue: number;
  groups: SalesFixtureGroup[];
}

/** One row of the manager's read-only fixture list for their store. */
export interface ManagerFixture {
  fixtureId: string;
  label: string;
  kind: FixtureKind;
  department?: Department | null;
  applicable: boolean;
  productCount: number;
}

/* -------------------------------------------------------------------------- */
/* COMPLIANCE LOOP — fixture photo vs the VM reference, scored by AI            */
/* -------------------------------------------------------------------------- */

/** The AI's verdict comparing a store photo to the guide reference. */
export type CaptureVerdict = "PASS" | "NEEDS_REVIEW" | "FAIL";
/** Where a fixture sits in the capture loop. */
export type ComplianceState = "todo" | "submitted" | "scored";

/** One fixture's compliance status on the manager's floor map. */
export interface FixtureCompliance {
  fixtureId: string;
  label: string;
  kind: FixtureKind;
  department?: Department | null;
  /** A photo is wanted this sale (cycle default) or by a reviewer request. */
  needsPhoto: boolean;
  state: ComplianceState;
  overall?: CaptureVerdict | null;
  hasReference: boolean;
  /** Floor-plan geometry, so the visualization can place this fixture. */
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  /** Signed thumbnail of the setter's submitted photo (for the visualization). */
  photoUrl?: string | null;
}

/* -------------------------------------------------------------------------- */
/* PROJECTS — the top-level container (Myer retail, Ambiente tradeshow)         */
/* -------------------------------------------------------------------------- */

export type ProjectKind = "RETAIL" | "TRADESHOW";

/** A venue (store) in a project — for the studio's venue list. */
export interface ProjectVenue {
  storeId: string;
  storeName: string;
}

/** A project the admin works in: its guide campaign, venues, and setup status. */
export interface ProjectDto {
  id: string;
  name: string;
  slug: string;
  kind: ProjectKind;
  /** The project's active guide campaign (the standard to set up + check against). */
  campaignId?: string | null;
  campaignKey?: string | null;
  campaignName?: string | null;
  /** Stores/venues in the project. */
  venueCount: number;
  /** Setup progress across the project's venues (fixtures captured / total). */
  fixturesTotal: number;
  fixturesCaptured: number;
}

/** The full compliance sheet for one fixture (the upload + compare screen). */
export interface FixtureComplianceDetail {
  fixtureId: string;
  label: string;
  kind: FixtureKind;
  department?: Department | null;
  /** VM / reviewer notes — what the manager should match. */
  notes: string;
  /** "What good looks like" reference image (signed URL). */
  referenceUrl?: string | null;
  referenceCaption?: string | null;
  /** The manager's submitted photo (signed URL). */
  myPhotoUrl?: string | null;
  state: ComplianceState;
  overall?: CaptureVerdict | null;
  /** The model's compare notes for the manager. */
  aiNotes?: string | null;
  confidence?: number | null;
  scoredAt?: string | null;
}

/* -------------------------------------------------------------------------- */
/* BULLETINS — the per-sale memo authored for a project; read + acknowledged    */
/* -------------------------------------------------------------------------- */

export interface BulletinDto {
  id: string;
  projectId: string;
  campaignId?: string | null;
  title: string;
  /** Markdown body. */
  body: string;
  pinned: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  /** Signed, time-limited URL to the attached PDF/image (never the raw key). */
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  /** Null while a draft. */
  publishedAt?: string | null;
  createdAt: string;
  /** Acknowledgement rollup (admin view): how many stores have acknowledged. */
  ackCount: number;
  ackTotal: number;
  /** Whether the signed-in manager's store has acknowledged (manager view). */
  acknowledged?: boolean;
}

/** One store's acknowledgement state for a bulletin (the admin ack list). */
export interface BulletinAckRow {
  storeId: string;
  storeName: string;
  acknowledged: boolean;
  acknowledgedAt?: string | null;
}

/* -------------------------------------------------------------------------- */
/* RESOURCES — the org's training & reference library (org-wide, no receipts)   */
/* -------------------------------------------------------------------------- */

/** A training/reference item: a category-grouped link OR uploaded file. */
export interface ResourceDto {
  id: string;
  title: string;
  description: string;
  /** Free-text grouping (e.g. "VM Standards", "Product Knowledge", "Safety"). */
  category: string;
  /** External link (video, doc, brand site) — set when this is a link resource. */
  url?: string | null;
  /** Signed, time-limited URL to the uploaded file (never the raw key). */
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  pinned: boolean;
  createdAt: string;
}
