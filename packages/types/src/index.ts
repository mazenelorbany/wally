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
  /** The library fixture this rubric grades. Null on legacy free-text rows. */
  fixtureId?: string | null;
  /** The linked fixture's display name (null on legacy rows — show fixtureKey). */
  fixtureName?: string | null;
  fixtureKey: string;
  campaignKey: string;
  version: number;
  criteria: Criterion[];
  rollupRule: RollupRule;
  referenceKey?: string | null;
  /**
   * Signed, time-limited URL to preview the reference image (never the raw key).
   * Null/absent when no reference is set for this version.
   */
  referenceUrl?: string | null;
  /**
   * True when this is the live grading version for (campaign, fixtureKey) — the
   * row the scorer resolves. Exactly one version per pair is active once a
   * publish/activate has run; legacy/seeded rows are all false (the scorer falls
   * back to the highest version when none is flagged).
   */
  active: boolean;
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
 * One store's sales rollup for a campaign — units and revenue logged across the
 * (optional) date window. The leaderboard ranks primarily on `revenue`, with
 * compliance as the tiebreaker. Every ACTIVE store appears, including stores
 * with zero sales so far (units/revenue = 0).
 */
export interface StoreSales {
  storeId: string;
  storeName: string;
  region?: string | null;
  units: number;
  revenue: number;
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
  /**
   * The actionable backlog: NEEDS_REVIEW verdicts that have NO reviewer action
   * yet. avgReviewMinutes only measures what WAS reviewed, so this is the honest
   * "still waiting" count that the average hides.
   */
  awaitingReview: number;
  /**
   * Age in minutes of the oldest still-unreviewed NEEDS_REVIEW verdict (null
   * when the backlog is empty) — how stale the queue's worst case is.
   */
  oldestPendingAgeMinutes: number | null;
  /** Stores with the most revisions, worst first. */
  mostRevised: { storeId: string; storeName: string; revisions: number }[];
}

/** How a trend point was authored — the nightly cron, or an admin "capture now". */
export type SnapshotSource = "CRON" | "MANUAL";

/** One day's compliance rollup for a campaign — a point on the trend chart. */
export interface ComplianceTrendPoint {
  /** 'YYYY-MM-DD' (UTC). */
  dateKey: string;
  /** ISO timestamp the snapshot was captured. */
  capturedAt: string;
  /** Who wrote this point (CRON canonical; MANUAL = an admin "capture now"). */
  source: SnapshotSource;
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

/** A product's promo-wave membership (TCC runs two alternating monthly waves). */
export type SaleWave = "SALE_1" | "SALE_2" | "BOTH";

/**
 * Which wave the org is selling right now: AUTO follows the TCC calendar
 * (odd months = Sale 1, even months = Sale 2), SALE_1/SALE_2 pin a wave,
 * ALL puts the whole catalog on sale.
 */
export type SaleMode = "AUTO" | "SALE_1" | "SALE_2" | "ALL";

/** The wave the calendar says is on for a given date (odd month = Sale 1). */
export function autoSaleWave(date: Date = new Date()): "SALE_1" | "SALE_2" {
  return (date.getMonth() + 1) % 2 === 1 ? "SALE_1" : "SALE_2";
}

/** Resolve a saleMode to the wave actually selling ("ALL" = every wave). */
export function activeSaleWave(
  mode: SaleMode,
  date: Date = new Date(),
): "SALE_1" | "SALE_2" | "ALL" {
  return mode === "AUTO" ? autoSaleWave(date) : mode;
}

/** Whether a product sells at its salePrice under the given saleMode. */
export function isOnSale(
  product: { saleWave?: SaleWave | null; salePrice?: number | null },
  mode: SaleMode,
  date: Date = new Date(),
): boolean {
  if (product.salePrice == null) return false;
  const active = activeSaleWave(mode, date);
  if (active === "ALL") return true;
  if (!product.saleWave) return false;
  return product.saleWave === "BOTH" || product.saleWave === active;
}

/** The current tenant (org settings). */
export interface OrgDto {
  id: string;
  name: string;
  slug: string;
  /** Which promo wave is selling now — see {@link SaleMode}. */
  saleMode: SaleMode;
}

/** A store in the org's roster (admin store-directory management). */
export interface StoreDto {
  id: string;
  name: string;
  brand: string;
  /** The project (venue group) this store belongs to; null = unassigned. */
  projectId?: string | null;
  externalRef?: string | null;
  region?: string | null;
  areaManager?: string | null;
  storeType?: string | null;
  /** Set when the store has been deactivated/retired; null = active. */
  closedAt?: string | null;
}

/**
 * The org's existing DISTINCT segmentation values (non-null, trimmed, sorted) —
 * backs the store-directory comboboxes so "NSW" / "N.S.W." / "nsw" converge.
 */
export interface StoreSegments {
  regions: string[];
  storeTypes: string[];
  areaManagers: string[];
}

export type Role =
  | "ADMIN"
  | "REVIEWER"
  | "STORE_MANAGER"
  | "VIEWER"
  | "SETUP_CREW";
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
  /** ISO timestamp of the last change to this user (role/store/disable edits). */
  updatedAt: string;
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
  /**
   * The project that owns this fixture. Null = a shared fixture visible in every
   * project; a project id scopes it to that project's library + floor plans.
   */
  projectId?: string | null;
  /** Library-level "what good looks like" reference image (signed URL), if set. */
  referenceUrl?: string | null;
  referenceCaption?: string | null;
}

/**
 * A library fixture with its DEFAULT guide content — the reusable standard a new
 * task inherits when it first opens this fixture (notes + ordered instructions +
 * checklist). Edited in the fixture-library dialog; still overridable per task.
 */
export interface FixtureLibraryDetail extends Fixture {
  defaultNotes: string;
  defaultInstructions: GuideInstructionStep[];
  defaultChecklist: GuideChecklistItem[];
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
  /** Full retail title (from baccarat.com.au) — distinct from the VM label. */
  webTitle?: string;
  brand?: string;
  /** Baccarat range: "Le Connoisseur", "Nook", "Iconix"… */
  range?: string;
  category?: string;
  color?: string;
  imageUrl?: string;
  /** Recommended retail price. */
  rrp?: number;
  /** Current sale/ticket price — the per-unit price the sales log snapshots. */
  salePrice?: number;
  /** Promo-wave membership; null/absent = never on promo. */
  saleWave?: SaleWave | null;
  /** Gift-with-purchase: offered free alongside a qualifying purchase. */
  gwp?: boolean;
  /** The qualifying product this gift is free with (when gwp is set). */
  gwpWith?: { id: string; name: string; sku: string } | null;
  /** Set when the product has been archived (soft-deleted); null/absent = active. */
  archivedAt?: string | null;
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
/** One ordered setup step on a fixture (distinct from the free-form notes). */
export interface GuideInstructionStep {
  id: string;
  text: string;
}

/** One per-fixture checklist item the manager ticks while filling the report. */
export interface GuideChecklistItem {
  id: string;
  label: string;
  required: boolean;
}

/** A checklist item with this store's ticked state (manager fill view). */
export interface FixtureChecklistState {
  id: string;
  label: string;
  required: boolean;
  checked: boolean;
  /** True when the AI auto-ticked this item (high-confidence PASS), not a person.
   *  Only non-required items are ever auto-ticked; the manager can untick. */
  aiTicked?: boolean;
  /** The AI confidence (0–1) at the moment it auto-ticked, for the "AI · 97%" badge. */
  aiConfidence?: number | null;
}

export interface GuideFixtureDetail {
  /** The Fixture's id (its identity on the floor plan). */
  fixtureId: string;
  /** The GuideFixture row id — address for notes + add/remove merchandise. */
  guideFixtureId: string;
  fixtureName: string;
  kind: FixtureKind;
  notes: string;
  /** Ordered structured setup steps (separate from `notes`). */
  instructions: GuideInstructionStep[];
  exampleImages: GuideFixtureExampleImage[];
  merchandise: MerchandiseRow[];
  /** The per-fixture checklist items (templates; manager ticks them per store). */
  checklist: GuideChecklistItem[];
}

/**
 * One photo-request fixture in a task's "Build" view — a fixture placed on at
 * least one store's floor plan for the campaign, with a summary of how much of
 * its guide content (reference image / instructions / checklist) is filled in.
 */
export interface CampaignFixtureSummary {
  fixtureId: string;
  /** The GuideFixture (content sheet) id, if it's been opened yet; else null. */
  guideFixtureId: string | null;
  name: string;
  kind: FixtureKind;
  department?: Department | null;
  /** How many of the task's stores place this fixture. */
  storeCount: number;
  /** A reference image exists (library default or an uploaded example). */
  hasReference: boolean;
  instructionCount: number;
  checklistCount: number;
  productCount: number;
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
  /** The campaign this task accompanies (e.g. a "Report requested" notice) —
   *  lets the manager Tasks list fold the notice into its report row. */
  campaignId?: string | null;
  dueAt?: string | null;
  /**
   * Whether the CURRENT viewer has seen this task (per-user, from TaskRead).
   * `false` means it's unread for them — the dot/badge. Computed for the
   * requesting user, so a co-manager's read state never leaks across.
   */
  seen?: boolean;
  completedAt?: string | null;
  /** Who completed it (display name), when DONE. */
  completedByName?: string | null;
  /** The individual manager it's assigned to (display name), if narrowed. */
  assignedToName?: string | null;
  createdAt: string;
}

/** Body for an admin editing a task (title / body / due date / status). */
export interface UpdateTaskBody {
  title?: string;
  body?: string | null;
  dueAt?: string | null;
  status?: TaskStatus;
}

/** One row of the admin's task list (a store task with its store name). */
export interface AdminTaskDto extends TaskDto {
  storeId: string;
  storeName: string;
}

/** The store manager's own notification preferences. */
export interface ManagerPreferences {
  /** Alert (badge) on newly-assigned tasks. */
  notifyOnNewTask: boolean;
}

/** The signed-in user's own account preferences (admin/reviewer Settings). */
export interface MePreferences {
  /** Receive the daily "store still owes photos" chase email. */
  chaseEmails: boolean;
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
  /** Tasks THIS manager hasn't opened yet (per-user) — the red bell count. */
  unseenTasks: number;
  /** OPEN tasks whose dueAt is in the past — the overdue count. */
  overdueTasks: number;
  checklist: { total: number; done: number };
  /**
   * Sales snapshot for the manager home tile. `today` matches what the linked
   * Sales Log opens to (the current UTC day), `campaignToDate` is the running
   * campaign total — the tile shows both, clearly labelled, so neither figure is
   * ambiguous against the day-scoped log. `loggedProducts` is the DISTINCT count
   * of products with logged units campaign-to-date.
   */
  sales: {
    today: { totalRevenue: number; totalUnits: number };
    campaignToDate: { totalRevenue: number; totalUnits: number };
    loggedProducts: number;
  };
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

/** A normalized rectangle on the photo (0..1, origin top-left). */
export interface IssueBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One AI-detected defect, with a box locating it ON the photo so the UI can
 * highlight exactly where the problem is. Produced by the vision compare and
 * persisted with the capture.
 */
export interface ComplianceIssue {
  /** Short defect name, e.g. "Leaning box". */
  label: string;
  /** One concrete fix for the store, e.g. "Straighten the top-left box". */
  fix?: string | null;
  /** How serious it is. */
  severity?: "minor" | "major" | null;
  /** Where it is on the photo (normalized). Omitted if the model gave no box. */
  box?: IssueBox | null;
  /**
   * Which photo in the capture's gallery this defect is on (0-based index into
   * `photos[]`). Defaults to 0 (the cover) for legacy single-photo captures.
   */
  photoIndex?: number | null;
}

/** One photo in a fixture capture's gallery (the multi-photo set). */
export interface CapturePhoto {
  id: string;
  /** Signed URL of the photo. */
  url?: string | null;
  /** AI-detected defects located on THIS photo (the set's issues, filtered). */
  issues?: ComplianceIssue[] | null;
}

/** One preserved shot in a fixture's capture history (newest first). */
export interface CaptureAttempt {
  id: string;
  /** Signed thumbnail of this shot's photo. */
  photoUrl?: string | null;
  /** The AI verdict scored for this shot (null if it was never scored). */
  verdict?: CaptureVerdict | null;
  /** The model's compare notes for this shot. */
  aiNotes?: string | null;
  /** AI-detected defects with on-image boxes for this shot. */
  issues?: ComplianceIssue[] | null;
  confidence?: number | null;
  /** When this shot was taken (ISO). */
  capturedAt: string;
  /** Who took this shot (name or email), if known. */
  capturedByName?: string | null;
}

/** One fixture's compliance status on the manager's floor map. */
export interface FixtureCompliance {
  fixtureId: string;
  label: string;
  kind: FixtureKind;
  department?: Department | null;
  /** A photo is wanted this sale (cycle default) or by a reviewer request. */
  needsPhoto: boolean;
  state: ComplianceState;
  /** The AI's verdict for the current photo. */
  overall?: CaptureVerdict | null;
  /** A reviewer's human override, if one was set (supersedes `overall`). */
  overrideVerdict?: CaptureVerdict | null;
  /** What money-map / floor / UI should show: `overrideVerdict ?? overall`. */
  effectiveVerdict?: CaptureVerdict | null;
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
  /** Set when the project has been archived (soft-deleted); null/absent = active. */
  archivedAt?: string | null;
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
  /** The manager's submitted photo (signed URL) — the COVER (photos[0]). */
  myPhotoUrl?: string | null;
  /** The full photo gallery for this fixture (multi-photo set, cover first). */
  photos: CapturePhoto[];
  /** This fixture's checklist items with THIS store's ticked state. */
  checklist: FixtureChecklistState[];
  state: ComplianceState;
  /** The AI's verdict for the current photo. */
  overall?: CaptureVerdict | null;
  /** The model's compare notes for the manager. */
  aiNotes?: string | null;
  /** AI-detected defects with on-image boxes for the current photo. */
  issues?: ComplianceIssue[] | null;
  confidence?: number | null;
  scoredAt?: string | null;
  /** A photo is wanted (cycle default) or has been re-requested by a reviewer. */
  needsPhoto?: boolean;
  /** A reviewer's human override, if one was set (supersedes `overall`). */
  overrideVerdict?: CaptureVerdict | null;
  /** Optional reviewer rationale captured with the override. */
  overrideNote?: string | null;
  /** Who set the override (name or email), and when (ISO). */
  reviewedByName?: string | null;
  reviewedAt?: string | null;
  /** Who requested a re-shoot (name or email), and when (ISO). */
  requestedByName?: string | null;
  requestedAt?: string | null;
  /** What money-map / floor / UI should show: `overrideVerdict ?? overall`. */
  effectiveVerdict?: CaptureVerdict | null;
  /** Every preserved shot for this fixture, newest first (the capture history). */
  attempts: CaptureAttempt[];
}

/** Body for a reviewer overriding a fixture-capture's AI verdict. */
export interface OverrideCaptureBody {
  /** The human decision that supersedes the AI verdict. */
  verdict: CaptureVerdict;
  /** Optional rationale. */
  note?: string;
}

/* -------------------------------------------------------------------------- */
/* STORE REPORTS — campaign extra questions + the submittable store report      */
/* -------------------------------------------------------------------------- */

/** The input type of an admin-defined report question. */
export type CampaignQuestionType = "SHORT_TEXT" | "YES_NO" | "LONG_NOTE";

/** An admin-authored extra question on a campaign's report (ordered). */
export interface CampaignQuestionDto {
  id: string;
  order: number;
  label: string;
  type: CampaignQuestionType;
  required: boolean;
  /** Whether the store may mark this question "N/A". */
  allowNA: boolean;
}

/** A store's answer to one campaign question. */
export interface QuestionAnswerDto {
  questionId: string;
  /** For SHORT_TEXT / LONG_NOTE. */
  valueText?: string | null;
  /** For YES_NO. */
  valueBool?: boolean | null;
  isNA: boolean;
  /** Who answered (name or email) and when (ISO). */
  answeredByName?: string | null;
  answeredAt?: string | null;
}

/** A campaign question paired with this store's current answer (manager view). */
export interface CampaignQuestionWithAnswer extends CampaignQuestionDto {
  answer?: QuestionAnswerDto | null;
}

/** Body for creating/updating a campaign question (admin). */
export interface CampaignQuestionInput {
  label: string;
  type: CampaignQuestionType;
  required?: boolean;
  allowNA?: boolean;
}

/** Body for a store answering a campaign question (manager). */
export interface AnswerQuestionBody {
  valueText?: string | null;
  valueBool?: boolean | null;
  isNA?: boolean;
}

/** The lifecycle of a store's report for a campaign. */
export type StoreReportStatus =
  | "DRAFT"
  | "PENDING"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "REOPENED";

/** Why a store's report is worth attention (the admin reports list badges). */
export interface ReportFlags {
  /** Any fixture's effective verdict is FAIL. */
  nonCompliant: boolean;
  /** Any scored capture's AI confidence is below the low-confidence threshold. */
  lowConfidence: boolean;
  /** Applicable fixtures unscored, or required questions unanswered, or not submitted. */
  incomplete: boolean;
  /** No report submitted yet. */
  notSubmitted: boolean;
}

/** The store's report envelope for a campaign (status, score, flags, progress). */
export interface StoreReportDto {
  storeId: string;
  campaignId: string;
  status: StoreReportStatus;
  /** When the report was sent to the store, and its due date (if set). */
  assignedAt?: string | null;
  dueAt?: string | null;
  submittedAt?: string | null;
  submittedByName?: string | null;
  /** Pass-rate % across applicable fixtures (frozen at submit; live for drafts). */
  totalScore?: number | null;
  /** Progress: photo steps. */
  fixturesExpected: number;
  fixturesScored: number;
  /** Progress: extra-question steps. */
  questionsTotal: number;
  questionsAnswered: number;
  /** Required questions still unanswered (blocks submit). */
  requiredUnanswered: number;
  /** Progress: per-fixture checklist ticks. */
  checklistTotal: number;
  checklistChecked: number;
  requiredUnchecked: number;
  flags: ReportFlags;
  /** AI prose summary (filled lazily; null when unavailable). */
  aiSummary?: string | null;
  summarizedAt?: string | null;
}

/** One row in the admin reports list (per store, flag-driven worklist). */
export interface StoreReportSummaryDto {
  storeId: string;
  storeName: string;
  brand: string;
  region?: string | null;
  status: StoreReportStatus;
  totalScore?: number | null;
  assignedAt?: string | null;
  dueAt?: string | null;
  submittedAt?: string | null;
  flags: ReportFlags;
}

/** Body to send (assign) a campaign's report to stores. */
export interface ReportSendBody {
  storeIds: string[];
  /** Optional due date (ISO). */
  dueAt?: string | null;
}

/** Result of sending a report out. */
export interface ReportSendResult {
  sent: number;
}

/** One report in a store manager's history list (current + past campaigns). */
export interface ManagerReportListItem {
  campaignId: string;
  campaignKey: string;
  campaignName: string;
  status: StoreReportStatus;
  totalScore?: number | null;
  dueAt?: string | null;
  submittedAt?: string | null;
}

/** The low-confidence flag threshold (AI confidence below this is flagged). */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

/** One fixture (photo) step in the rendered report document. */
export interface ReportDocFixture {
  fixtureId: string;
  label: string;
  status: "scored" | "not_submitted" | "not_applicable";
  /** Effective verdict (override beats AI), when scored. */
  verdict?: CaptureVerdict | null;
  confidence?: number | null;
  aiNotes?: string | null;
  issues?: ComplianceIssue[] | null;
  /** The photo gallery for this step (signed URLs). */
  photos: CapturePhoto[];
  /** This fixture's checklist with the store's ticked state. */
  checklist: FixtureChecklistState[];
  /** Who took the most recent shot, and when (ISO). */
  completedByName?: string | null;
  completedAt?: string | null;
}

/** One extra-question step in the rendered report document. */
export interface ReportDocQuestion {
  id: string;
  label: string;
  type: CampaignQuestionType;
  valueText?: string | null;
  valueBool?: boolean | null;
  isNA: boolean;
  answeredByName?: string | null;
  answeredAt?: string | null;
}

/** The full rendered report — the Myer-style document (header + every step). */
export interface StoreReportDocument {
  store: { id: string; name: string; brand: string };
  campaign: { id: string; key: string; name: string };
  status: StoreReportStatus;
  submittedAt?: string | null;
  submittedByName?: string | null;
  totalScore?: number | null;
  aiSummary?: string | null;
  summarizedAt?: string | null;
  flags: ReportFlags;
  fixtures: ReportDocFixture[];
  questions: ReportDocQuestion[];
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
  /**
   * Acknowledgement rollup (admin view): how many of the must-read managers have
   * acknowledged. The denominator is the store-manager population in the project's
   * active stores (every manager must read), not the store count.
   */
  ackCount: number;
  ackTotal: number;
  /** Whether the signed-in manager (this user) has acknowledged (manager view). */
  acknowledged?: boolean;
  /**
   * Schedule state derived from startsAt/endsAt vs now (admin annotation):
   *  - "scheduled": startsAt is in the future (not yet live)
   *  - "live": within the [startsAt, endsAt] window (or unbounded)
   *  - "expired": endsAt has passed
   * Managers only ever see in-window ("live") bulletins; the admin list badges all
   * three. A draft (no publishedAt) has no schedule state.
   */
  scheduleState?: BulletinScheduleState | null;
}

export type BulletinScheduleState = 'scheduled' | 'live' | 'expired';

/** One manager's acknowledgement state for a bulletin (the admin ack roster). */
export interface BulletinAckRow {
  storeId: string;
  storeName: string;
  acknowledged: boolean;
  acknowledgedAt?: string | null;
  /** Who acknowledged (the manager), when acknowledged — null while pending. */
  userId?: string | null;
  userName?: string | null;
  userEmail?: string | null;
}

/* -------------------------------------------------------------------------- */
/* RESOURCES — the org's training & reference library (org-wide, no receipts)   */
/* -------------------------------------------------------------------------- */

/** A training/reference item: a topic/sub-topic-filed link OR uploaded file. */
export interface ResourceDto {
  id: string;
  title: string;
  description: string;
  /** TOPIC — the top-level grouping (e.g. "VM Standards", "Product Knowledge"). */
  category: string;
  /** SUB-TOPIC within the topic (e.g. "Knife wall", "Cookware"). "" = none. */
  subtopic: string;
  /** External link (video, doc, brand site) — set when this is a link resource. */
  url?: string | null;
  /** Signed, time-limited URL to the uploaded file (never the raw key). */
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  pinned: boolean;
  createdAt: string;
}

// ----- Review threads (comments on a store's report) -------------------------

export type ReviewThreadStatus = 'OPEN' | 'RESOLVED';

export interface ReviewCommentDto {
  id: string;
  body: string;
  authorName: string;
  /** Role chip next to the author — managers vs. head office reads differently. */
  authorRole: Role;
  createdAt: string;
}

/**
 * A review conversation anchored to one piece of a store's report: a fixture's
 * photo step (optionally pinned to a spot on one photo, normalized 0..1) or a
 * question answer. Admin/reviewer opens it, the store manager replies, a
 * moderator resolves.
 */
export interface ReviewThreadDto {
  id: string;
  storeId: string;
  campaignId: string;
  fixtureId: string | null;
  questionId: string | null;
  photoId: string | null;
  pinX: number | null;
  pinY: number | null;
  status: ReviewThreadStatus;
  createdAt: string;
  createdByName: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
  comments: ReviewCommentDto[];
}

/** Body for opening a review thread (the first comment rides along). */
export interface CreateReviewThreadBody {
  storeId: string;
  campaignId: string;
  fixtureId?: string;
  questionId?: string;
  photoId?: string;
  pinX?: number;
  pinY?: number;
  body: string;
}
