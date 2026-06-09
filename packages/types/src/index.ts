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
  /** The manager's submitted photo (signed URL). */
  myPhotoUrl?: string | null;
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
