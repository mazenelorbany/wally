// @wally/sdk — typed API client for the Wally backend.
//
// Pure runtime over `fetch`. Returns the shared contract shapes from
// `@wally/types`. Used by the web app (Vite/ESM) and any Node tooling.
// Cookie-session auth: every request sends `credentials: 'include'` so the
// browser attaches the `wally_session` cookie set by the API.

import type {
  ScoreResult,
  StoreScore,
  StoreSales,
  StoreDto,
  StoreSegments,
  OrgDto,
  UserDto,
  Rubric,
  Criterion,
  RollupRule,
  ComplianceTurnaround,
  ComplianceTrendPoint,
  SnapshotSource,
  BestInClassItem,
  SessionUser,
  Role,
  Fixture,
  FixtureKind,
  FixtureUsage,
  FixtureDefaultProduct,
  Department,
  FloorPlan,
  PlacedFixture,
  GuideFixtureDetail,
  ProductDto,
  GalleryItem,
  MoneyMap,
  ProjectDto,
  ProjectKind,
  ProjectVenue,
  ManagerHome,
  ManagerFixture,
  ManagerPreferences,
  MePreferences,
  SalesLog,
  TaskDto,
  AdminTaskDto,
  TaskKind,
  TaskStatus,
  FixtureCompliance,
  FixtureComplianceDetail,
  OverrideCaptureBody,
  BulletinDto,
  BulletinAckRow,
  BulletinScheduleState,
  ResourceDto,
} from "@wally/types";

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Thrown on any non-2xx response. Carries the HTTP status, the parsed body
 * (when JSON), and a human-readable message lifted from the API error shape
 * (`{ message }` / `{ error }`) when present.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly body: unknown;

  constructor(args: {
    status: number;
    statusText: string;
    url: string;
    body: unknown;
    message?: string;
  }) {
    super(args.message ?? `${args.status} ${args.statusText}`);
    this.name = "ApiError";
    this.status = args.status;
    this.statusText = args.statusText;
    this.url = args.url;
    this.body = args.body;
    // Restore prototype chain for instanceof across transpile targets.
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/* -------------------------------------------------------------------------- */
/* Request payload / response contracts                                       */
/* -------------------------------------------------------------------------- */

export interface MagicLinkResponse {
  /** Always true on success; the link itself is delivered out of band (email). */
  sent: boolean;
}

/**
 * An OPTIONAL date window for the period-scoped analytics surfaces (queue,
 * turnaround, trend). `from`/`to` are ISO timestamps; either bound may be
 * omitted. When the whole window is absent the surface is all-time (the
 * historical, backward-compatible behaviour) — existing callers pass nothing
 * and get exactly what they got before.
 */
export interface DateWindow {
  /** Inclusive lower bound (ISO). Omit for "since the beginning". */
  from?: string;
  /** Inclusive upper bound (ISO). Omit for "up to now". */
  to?: string;
}

export interface CampaignSummary {
  id: string;
  key: string;
  name: string;
  status: string;
  /** Window config — advisory; rendered in the list + Insights header. */
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  /** Lifecycle audit timestamps (when it went live / was closed / archived). */
  activatedAt: string | null;
  closedAt: string | null;
  archivedAt: string | null;
  storeCount: number;
}

export interface Submission {
  id: string;
  storeId: string;
  campaignId: string;
  storeName: string;
  campaignKey: string;
  /** The store's applicable fixtures = the checklist (ordered). */
  fixtures: SubmissionFixture[];
  photos: SubmissionPhoto[];
}

export interface SubmissionFixture {
  fixtureKey: string;
  label: string;
  order: number;
}

/**
 * A scored photo on the reviewer bench. The full ScoreResult (overall,
 * confidence, flags, per-criterion results, rubricVersion) plus the VERDICT id
 * — the review endpoint is keyed by verdict id, so the bench submits decisions
 * against `score.id`, not the photo id.
 */
export interface ReviewableScore extends ScoreResult {
  /** The verdict id — pass to `verdicts.review(id, …)`. */
  id: string;
  createdAt?: string;
}

export interface SubmissionPhoto {
  id: string;
  fixtureKey: string;
  status: string;
  /** Signed, time-limited URL — never the raw storage key. */
  url?: string;
  /** The AI verdict, presented for review. Null/absent until scored. */
  score?: ReviewableScore | null;
}

/** Result of uploading one photo to a submission. */
export interface UploadedPhoto {
  id: string;
  submissionId: string;
  fixtureKey: string;
  status: string;
}

export type ReviewAction = "CONFIRM" | "OVERRIDE" | "ESCALATE";

/** Body for a reviewer's decision on a verdict. */
export interface ReviewBody {
  action: ReviewAction;
  /** Required when action is OVERRIDE — the corrected overall band. */
  overall?: ScoreResult["overall"];
  note?: string;
}

export interface ReviewResult {
  id: string;
  verdictId: string;
  action: ReviewAction;
}

/** A signed, time-limited URL to a store's PDF/report. */
export interface ReportUrl {
  url: string;
  expiresAt: string;
}

/* ---- CREATE GUIDE ---- */

/** Body for moving/resizing a placed fixture on a floor plan. */
export interface PlacementMoveBody {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

/**
 * Body for PATCH /placements/:id — edit a placed fixture. Geometry plus the
 * editable per-placement fields: `label` (inline rename), `order` (reorder the
 * manager checklist), and `applicable` ("we don't have this fixture here"). Every
 * field is optional, but the API requires at least one.
 */
export interface UpdatePlacementBody {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotation?: number;
  label?: string;
  order?: number;
  applicable?: boolean;
}

/** Body for editing a library fixture (rename / re-kind / re-classify). */
export interface UpdateFixtureBody {
  name?: string;
  kind?: FixtureKind;
  /** Myer department; `null` clears the classification. */
  department?: Department | null;
  /** Re-home the fixture: a project id moves it; `null` makes it shared. */
  projectId?: string | null;
}

/** Body for creating a library fixture. */
export interface CreateFixtureBody {
  name: string;
  kind?: FixtureKind;
  department?: Department;
  /** Owning project; omit or `null` for a shared fixture (all projects). */
  projectId?: string | null;
}

/** Result of publishing a guide to its stores (publish & notify). */
export interface PublishResult {
  /** ISO timestamp the guide was published. */
  publishedAt: string;
  /** How many stores were notified (had a "floor plan ready" task fanned out). */
  notified: number;
}

/** One shelf in a planogram-reorder payload: a label + its facings, left→right. */
export interface PlanogramShelfInput {
  row: string;
  merchandiseIds: string[];
}

/** PATCH /guide-fixtures/:id/planogram — the full desired layout, top→bottom. */
export interface ReorderPlanogramBody {
  shelves: PlanogramShelfInput[];
}

/** Body for adding a fixture to a store's floor plan (the layout builder). */
export interface CreatePlacementBody {
  fixtureId: string;
  label?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotation?: number;
}

/** Body for creating a new project. */
export interface CreateProjectBody {
  name: string;
  kind: ProjectKind;
}

/**
 * Body for editing a project — rename and/or change its kind. Both fields are
 * optional (send only what changed) but the API requires at least one. The
 * `slug` is immutable (the stable per-org key), so it's intentionally absent.
 */
export interface UpdateProjectBody {
  name?: string;
  kind?: ProjectKind;
}

/** Body for creating a campaign (the guide period). */
export interface CreateCampaignBody {
  key: string;
  name: string;
  startsAt?: string;
  endsAt?: string;
}

/**
 * Body for editing a campaign. `key` is immutable (the stable per-org handle),
 * so it's intentionally absent. Dates are tri-state: omit = unchanged,
 * `null` = clear, a value = set.
 */
export interface UpdateCampaignBody {
  name?: string;
  startsAt?: string | null;
  endsAt?: string | null;
}

/** A campaign after create/activate (subset; the list adds storeCount). */
export interface CampaignBrief {
  id: string;
  key: string;
  name: string;
  status: string;
}

/** Body for adding a store to the roster. */
export interface CreateStoreBody {
  name: string;
  brand: string;
  /** The project (venue group) this store belongs to. Must be in the org. */
  projectId?: string;
  externalRef?: string;
  region?: string;
  areaManager?: string;
  storeType?: string;
}

/** Body for patching a store — any field; null clears it. */
export type UpdateStoreBody = Partial<{
  name: string;
  brand: string;
  /** Re-home the store to another in-org project, or null to detach it. */
  projectId: string | null;
  externalRef: string | null;
  region: string | null;
  areaManager: string | null;
  storeType: string | null;
}>;

/** Optional filters for the merchandising catalog. */
export interface ProductFilters {
  search?: string;
  brand?: string;
  category?: string;
  color?: string;
  /** Include archived (soft-deleted) products in the result. Default: hidden. */
  includeArchived?: boolean;
}

/** Body for adding a product to the org catalog. `sku` is the unique key. */
export interface CreateProductBody {
  sku: string;
  name: string;
  webTitle?: string;
  brand?: string;
  range?: string;
  category?: string;
  color?: string;
  imageUrl?: string;
  /** Recommended retail price (non-negative). */
  rrp?: number;
  /** Current sale/ticket price (non-negative) — the sales-log unit price. */
  salePrice?: number;
}

/**
 * Body for editing a product — every field optional (send only what changed).
 * `sku` is editable but still unique-checked (409 on collision). Text fields
 * accept `null` to clear the column.
 */
export interface UpdateProductBody {
  sku?: string;
  name?: string;
  webTitle?: string | null;
  brand?: string | null;
  range?: string | null;
  category?: string | null;
  color?: string | null;
  imageUrl?: string | null;
  rrp?: number | null;
  salePrice?: number | null;
}

/* ---- STORE MANAGER ---- */

/** Body for an admin assigning a task to a store's manager. */
export interface CreateTaskBody {
  kind: TaskKind;
  title: string;
  body?: string;
  fixtureKey?: string;
  dueAt?: string;
  /** Optionally narrow the task to one manager (else store-wide). */
  assignedToId?: string;
}

/** Body for an admin assigning one task to MANY stores at once. */
export interface BulkCreateTaskBody {
  storeIds: string[];
  kind: TaskKind;
  title: string;
  body?: string;
  fixtureKey?: string;
  dueAt?: string;
}

/** Body for an admin editing a task (title / body / due date / status). */
export interface UpdateTaskBody {
  title?: string;
  body?: string | null;
  dueAt?: string | null;
  status?: TaskStatus;
}

/** Body for a manager patching their own notification preferences. */
export interface UpdateManagerPreferencesBody {
  notifyOnNewTask?: boolean;
}

/** Body for the signed-in user patching their own account preferences. */
export interface UpdateMePreferencesBody {
  chaseEmails?: boolean;
}

/** Body for creating a bulletin (the file is sent separately as multipart). */
export interface CreateBulletinBody {
  title: string;
  body?: string;
  startsAt?: string;
  endsAt?: string;
  pinned?: boolean;
  /** Publish now (visible to managers); omit/false to keep it a draft. */
  publish?: boolean;
}

/** Body for editing a bulletin (an optional replacement file is sent as multipart). */
export interface UpdateBulletinBody {
  title?: string;
  body?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  pinned?: boolean;
  publish?: boolean;
  /** Drop the current attachment (ignored when a replacement file is supplied). */
  removeAttachment?: boolean;
}

/** Body for creating a resource (an uploaded file is sent separately). */
export interface CreateResourceBody {
  title: string;
  description?: string;
  /** Topic (top-level grouping). */
  category?: string;
  /** Sub-topic within the topic. */
  subtopic?: string;
  /** External link; omit when uploading a file instead. */
  url?: string;
  pinned?: boolean;
}

/** Body for editing a resource. */
export interface UpdateResourceBody {
  title?: string;
  description?: string;
  category?: string;
  subtopic?: string;
  url?: string | null;
  pinned?: boolean;
}

/** Body for inviting a teammate (admin user management). */
export interface InviteUserBody {
  email: string;
  name?: string;
  role: Role;
  storeId?: string;
}

/** Body for patching a user — role, store assignment, or (de)activation. */
export interface UpdateUserBody {
  role?: Role;
  storeId?: string | null;
  disabled?: boolean;
}

/** Body for publishing a new rubric version for one fixture. */
export interface PublishRubricBody {
  fixtureKey: string;
  criteria: Criterion[];
  rollupRule?: RollupRule;
  /**
   * Reference/standard image key the scorer compares against.
   *  - OMIT to carry the previous version's reference forward (an edit never
   *    silently drops it).
   *  - `null` to explicitly clear it.
   *  - a string (from `rubrics.uploadReferenceImage`) to set/replace it.
   */
  referenceKey?: string | null;
}

/** Result of uploading a rubric reference image. */
export interface UploadReferenceImageResult {
  /** Storage key to hand to `rubrics.publish` as `referenceKey`. */
  referenceKey: string;
  /** Signed, time-limited preview URL. */
  url: string;
}

/* -------------------------------------------------------------------------- */
/* Client                                                                     */
/* -------------------------------------------------------------------------- */

export interface CreateClientOptions {
  /**
   * API origin, e.g. `http://localhost:3000`. The client appends the API base
   * path (default `/api`) and route segments. Trailing slashes are trimmed.
   */
  baseUrl: string;
  /**
   * Base path the NestJS app is mounted under (global prefix). Defaults to
   * `/api`. Pass `""` if the API serves routes at the origin root.
   */
  basePath?: string;
  /** Override the global `fetch` (e.g. node-fetch, or a test double). */
  fetch?: typeof fetch;
}

export interface WallyClient {
  auth: {
    me(): Promise<SessionUser>;
    requestMagicLink(email: string): Promise<MagicLinkResponse>;
    /** Dev-only bypass; the API rejects this outside development. */
    devLogin(role: Role): Promise<SessionUser>;
    logout(): Promise<void>;
  };
  campaigns: {
    list(): Promise<CampaignSummary[]>;
    /**
     * The reviewer queue: one rolled-up StoreScore per store, attention-first.
     * Pass an OPTIONAL `window` to score only photos uploaded within it; omit it
     * (the default) for the all-time, latest-state behaviour.
     */
    queue(campaignId: string, window?: DateWindow): Promise<StoreScore[]>;
    /** Per-store sales rollup (units + revenue) — the leaderboard's primary rank. */
    sales(campaignId: string, window?: DateWindow): Promise<StoreSales[]>;
    /** Every execution image across the campaign's stores (the gallery). */
    gallery(campaignId: string): Promise<GalleryItem[]>;
    /**
     * Operational turnaround: review speed + rework hot-spots + the unreviewed
     * backlog. Pass an OPTIONAL `window` to bound it to reviews in that period;
     * omit it for all-time.
     */
    turnaround(
      campaignId: string,
      window?: DateWindow,
    ): Promise<ComplianceTurnaround>;
    /** Compliance snapshots over time (the trend chart). */
    trend(campaignId: string): Promise<ComplianceTrendPoint[]>;
    /** Capture today's compliance as a snapshot now (ADMIN). */
    captureSnapshot(campaignId: string): Promise<ComplianceTrendPoint>;
    /** Prune a single trend point by its dateKey ('YYYY-MM-DD'). ADMIN. */
    deleteTrendPoint(campaignId: string, dateKey: string): Promise<void>;
    /** Best-in-class execution photos to showcase to other stores. */
    bestInClass(campaignId: string): Promise<BestInClassItem[]>;
    /** Create a campaign (starts DRAFT). ADMIN. */
    create(body: CreateCampaignBody): Promise<CampaignBrief>;
    /** Edit a campaign's name / window (key is immutable). ADMIN. */
    update(campaignId: string, body: UpdateCampaignBody): Promise<CampaignBrief>;
    /** Promote a campaign to ACTIVE (closes the same project's active one). ADMIN. */
    activate(campaignId: string): Promise<CampaignBrief>;
    /** Close an ACTIVE campaign (ACTIVE → CLOSED). ADMIN. */
    close(campaignId: string): Promise<CampaignBrief>;
    /** Reopen a CLOSED campaign (CLOSED → ACTIVE). ADMIN. */
    reopen(campaignId: string): Promise<CampaignBrief>;
    /** Soft-archive a campaign (hides it from the list). ADMIN. */
    archive(campaignId: string): Promise<CampaignBrief>;
    /** Hard-delete a campaign — only when it has no history (else 409). ADMIN. */
    remove(campaignId: string): Promise<void>;
    /**
     * Publish the guide to its stores: stamp the campaign published and fan a
     * "floor plan ready" task to every store in the project. ADMIN.
     */
    publish(campaignId: string): Promise<PublishResult>;
  };
  /** Toggle the best-in-class flag on a store execution photo. */
  photos: {
    setBestInClass(
      photoId: string,
      value: boolean,
    ): Promise<{ id: string; bestInClass: boolean }>;
    /**
     * Re-open a FAILED (or stuck) photo for scoring — resets its job to PENDING
     * and the photo to UPLOADED so the worker re-enqueues it. REVIEWER/ADMIN.
     */
    rescore(photoId: string): Promise<{ id: string; status: string }>;
  };
  stores: {
    storeScore(id: string, campaignId: string): Promise<StoreScore>;
    /** The org's store roster (admin directory) — includes closed stores. */
    list(): Promise<StoreDto[]>;
    /** The org's existing DISTINCT segmentation values (directory comboboxes). */
    segments(): Promise<StoreSegments>;
    /** Add a store. ADMIN. */
    create(body: CreateStoreBody): Promise<StoreDto>;
    /** Patch a store's profile + segmentation dims. ADMIN. */
    update(id: string, body: UpdateStoreBody): Promise<StoreDto>;
    /** Deactivate (retire) a store — stamps closedAt=now. ADMIN. */
    deactivate(id: string): Promise<StoreDto>;
    /** Reactivate a closed store — clears closedAt. ADMIN. */
    reactivate(id: string): Promise<StoreDto>;
  };
  /** The current tenant's settings. */
  org: {
    get(): Promise<OrgDto>;
    /** Update org name / slug. ADMIN. */
    update(body: { name?: string; slug?: string }): Promise<OrgDto>;
  };
  /** Admin: rubric authoring (append-only, versioned per campaign+fixture). */
  rubrics: {
    list(campaignId: string): Promise<Rubric[]>;
    /** Publish a new rubric version for one fixture. ADMIN. */
    publish(campaignId: string, body: PublishRubricBody): Promise<Rubric>;
    /**
     * Upload a reference/standard image for a rubric; returns the storage key to
     * pass to `publish` as `referenceKey`, plus a preview URL. ADMIN.
     */
    uploadReferenceImage(
      campaignId: string,
      file: Blob | File,
    ): Promise<UploadReferenceImageResult>;
    /**
     * Make a specific version the live grading standard for one fixture (= roll
     * back to / promote an earlier version). ADMIN.
     */
    activate(
      campaignId: string,
      fixtureKey: string,
      version: number,
    ): Promise<Rubric>;
  };
  submissions: {
    /** The signed-in store manager's current checklist (store + active campaign). */
    current(): Promise<{ submissionId: string; campaignKey: string }>;
    get(id: string): Promise<Submission>;
    uploadPhoto(
      submissionId: string,
      fixtureKey: string,
      file: Blob | File,
    ): Promise<UploadedPhoto>;
  };
  verdicts: {
    review(id: string, body: ReviewBody): Promise<ReviewResult>;
  };
  reports: {
    /** Resolve a signed URL to the store's report (does not fetch the bytes). */
    url(storeId: string): Promise<ReportUrl>;
  };
  /** CREATE GUIDE — the org's fixture library. */
  fixtures: {
    /** The library scoped to a project (its own + shared); omit for org-wide. */
    list(projectId?: string): Promise<Fixture[]>;
    create(input: CreateFixtureBody): Promise<Fixture>;
    /** Edit a library fixture (rename / re-kind / re-classify). P2002 → 409. */
    update(id: string, body: UpdateFixtureBody): Promise<Fixture>;
    /** Where a fixture is used (stores + guides) — for the delete dialog. */
    usage(id: string): Promise<FixtureUsage>;
    /** Soft-delete: hide from the library, keep placements. */
    archive(id: string): Promise<void>;
    /** Hard-delete: remove the fixture and everything that hangs off it. */
    remove(id: string): Promise<void>;
    /** The fixture's default product set (its reusable starter list / planogram). */
    products: {
      list(fixtureId: string): Promise<FixtureDefaultProduct[]>;
      /** Add a product, optionally onto a planogram shelf (`row`). */
      add(fixtureId: string, productId: string, row?: string): Promise<void>;
      remove(fixtureId: string, fixtureProductId: string): Promise<void>;
      /**
       * Persist the whole default-set layout (shelves + order). The body uses the
       * same shape the planogram editor emits (`merchandiseIds` = the facing ids,
       * here FixtureProduct ids). Returns the refreshed default set.
       */
      reorder(
        fixtureId: string,
        body: ReorderPlanogramBody,
      ): Promise<FixtureDefaultProduct[]>;
    };
  };
  /** CREATE GUIDE — a store's floor plan for a campaign. */
  floorplan: {
    get(campaignId: string, storeId: string): Promise<FloorPlan>;
    /**
     * Copy one store's whole floor-plan layout onto another (the target).
     * Idempotent on (store, campaign, fixture). Returns the target's refreshed
     * floor plan. ADMIN.
     */
    copyLayout(
      campaignId: string,
      fromStoreId: string,
      toStoreId: string,
    ): Promise<FloorPlan>;
  };
  /** MONEY MAP — a store's floor plan recoloured by fixture revenue. */
  moneyMap: {
    get(campaignId: string, storeId: string): Promise<MoneyMap>;
  };
  /** CREATE GUIDE — move/resize a placed fixture on a floor plan. */
  placements: {
    move(id: string, body: PlacementMoveBody): Promise<void>;
    /**
     * Patch a placed fixture — geometry and/or the editable per-placement fields
     * (`label`, `order`, `applicable`). At least one field must be present.
     */
    patch(id: string, body: UpdatePlacementBody): Promise<void>;
    /** Add a fixture to a store's floor plan (layout builder). */
    create(
      campaignId: string,
      storeId: string,
      body: CreatePlacementBody,
    ): Promise<PlacedFixture>;
    /** Remove a fixture from a store's floor plan. */
    remove(id: string): Promise<void>;
  };
  /** PROJECTS — the admin's top-level containers (retail + tradeshow). */
  projects: {
    /** The org's projects. Archived hidden unless `includeArchived` is set. */
    list(includeArchived?: boolean): Promise<ProjectDto[]>;
    get(id: string): Promise<ProjectDto>;
    create(body: CreateProjectBody): Promise<ProjectDto>;
    /** Rename a project / change its kind (slug is immutable). ADMIN. */
    update(id: string, body: UpdateProjectBody): Promise<ProjectDto>;
    /** Soft-delete: leave the working list, keep campaigns/stores/bulletins. ADMIN. */
    archive(id: string): Promise<ProjectDto>;
    /** Restore an archived project back into the working list. ADMIN. */
    unarchive(id: string): Promise<ProjectDto>;
    /** Hard-delete. ADMIN; 409 if it still owns stores/campaigns/bulletins. */
    remove(id: string): Promise<void>;
    /** The project's venues (stores) — the real venue list, not the queue. */
    venues(id: string): Promise<ProjectVenue[]>;
  };
  /** CREATE GUIDE — a fixture's instruction sheet within a guide. */
  guideFixtures: {
    detail(
      campaignId: string,
      fixtureId: string,
    ): Promise<GuideFixtureDetail>;
    saveNotes(id: string, notes: string): Promise<void>;
    /** Copy the fixture's default products onto the sheet; returns it refreshed. */
    prepopulate(
      campaignId: string,
      fixtureId: string,
    ): Promise<GuideFixtureDetail>;
    /** Place a product on the sheet's planogram (by GuideFixture id). */
    addMerchandise(
      guideFixtureId: string,
      productId: string,
      row?: string,
    ): Promise<void>;
    /** Remove a placed product from the sheet. */
    removeMerchandise(
      guideFixtureId: string,
      merchandiseId: string,
    ): Promise<void>;
    /** Persist the full planogram layout (drag-and-drop). Returns the refreshed sheet. */
    reorderPlanogram(
      guideFixtureId: string,
      body: ReorderPlanogramBody,
    ): Promise<GuideFixtureDetail>;
    /**
     * Upload a "what good looks like" reference image (optional caption). The
     * first image added becomes best-in-class. Returns the refreshed sheet.
     */
    addExampleImage(
      guideFixtureId: string,
      file: Blob | File,
      caption?: string,
    ): Promise<GuideFixtureDetail>;
    /** Edit an example image's caption (empty string clears it). */
    updateExampleImageCaption(
      guideFixtureId: string,
      imageId: string,
      caption: string,
    ): Promise<GuideFixtureDetail>;
    /** Mark an example image best-in-class (unsets its siblings). */
    setExampleImageBestInClass(
      guideFixtureId: string,
      imageId: string,
    ): Promise<GuideFixtureDetail>;
    /** Remove an example image. */
    removeExampleImage(
      guideFixtureId: string,
      imageId: string,
    ): Promise<GuideFixtureDetail>;
  };
  /** CREATE GUIDE — the merchandising catalog. */
  products: {
    list(filters?: ProductFilters): Promise<ProductDto[]>;
    /** Add a product to the catalog. ADMIN; 409 on a duplicate sku. */
    create(body: CreateProductBody): Promise<ProductDto>;
    /** Edit a product (sku editable, still unique-checked). ADMIN; 409 on collision. */
    update(id: string, body: UpdateProductBody): Promise<ProductDto>;
    /** Soft-delete: leave the working catalog, keep merchandise + sales. ADMIN. */
    archive(id: string): Promise<ProductDto>;
    /** Restore an archived product back into the working catalog. ADMIN. */
    unarchive(id: string): Promise<ProductDto>;
    /** Hard-delete. ADMIN; 409 if the product is merchandised or has sales. */
    remove(id: string): Promise<void>;
  };
  /**
   * STORE MANAGER — the signed-in manager's own store workspace. Every call is
   * scoped to the session user's store + the active campaign. An ADMIN/REVIEWER
   * may pass `storeId` to view any store's workspace (the demo store switcher);
   * a STORE_MANAGER's `storeId` argument is ignored server-side.
   */
  manager: {
    home(storeId?: string): Promise<ManagerHome>;
    tasks(storeId?: string): Promise<TaskDto[]>;
    completeTask(taskId: string, storeId?: string): Promise<void>;
    /** Reopen a completed task (DONE → OPEN) — recover a mis-tapped completion. */
    reopenTask(taskId: string, storeId?: string): Promise<void>;
    /** Mark every open task as seen for me (clears MY notification badge). */
    markTasksSeen(storeId?: string): Promise<void>;
    /** My own notification preferences. */
    preferences(): Promise<ManagerPreferences>;
    /** Patch my notification preferences. */
    updatePreferences(
      body: UpdateManagerPreferencesBody,
    ): Promise<ManagerPreferences>;
    fixtures(storeId?: string): Promise<ManagerFixture[]>;
    products(storeId?: string): Promise<ProductDto[]>;
    /** Sales for one day (defaults to today). `date` is 'YYYY-MM-DD'. */
    salesLog(storeId?: string, date?: string): Promise<SalesLog>;
    /** Set the units sold for one product on a day (idempotent upsert). */
    logSale(
      productId: string,
      units: number,
      storeId?: string,
      date?: string,
    ): Promise<void>;
    /** Per-fixture compliance status for the floor map (photo wanted / scored). */
    compliance(storeId?: string): Promise<FixtureCompliance[]>;
    /** One fixture's compliance sheet: reference, notes, my photo, verdict. */
    fixtureCompliance(
      fixtureId: string,
      storeId?: string,
    ): Promise<FixtureComplianceDetail>;
    /** Upload the manager's photo for a fixture; AI compares it to the guide. */
    uploadFixturePhoto(
      fixtureId: string,
      file: Blob | File,
      storeId?: string,
    ): Promise<FixtureComplianceDetail>;
    /**
     * REVIEWER/ADMIN: re-request a photo for a fixture ("redo this") — raises
     * needsPhoto and stamps the requester. Returns the updated sheet.
     */
    requestCapturePhoto(
      fixtureId: string,
      storeId?: string,
    ): Promise<FixtureComplianceDetail>;
    /**
     * REVIEWER/ADMIN: override a fixture-capture's AI verdict with a human
     * decision (supersedes the AI verdict for compliance/money-map/UI).
     */
    overrideCapture(
      fixtureId: string,
      body: OverrideCaptureBody,
      storeId?: string,
    ): Promise<FixtureComplianceDetail>;
  };
  /** ADMIN — assign / list / edit / cancel store tasks. */
  adminTasks: {
    create(storeId: string, body: CreateTaskBody): Promise<TaskDto>;
    /** Assign one task to many stores at once (the bulk "assign to all"). */
    bulkCreate(body: BulkCreateTaskBody): Promise<{ created: number }>;
    /** The org's tasks (optionally one store) for the Studio task view. */
    list(storeId?: string): Promise<AdminTaskDto[]>;
    update(id: string, body: UpdateTaskBody): Promise<TaskDto>;
    remove(id: string): Promise<void>;
  };
  /** Admin: user & role management. */
  adminUsers: {
    list(): Promise<UserDto[]>;
    invite(body: InviteUserBody): Promise<UserDto>;
    update(id: string, body: UpdateUserBody): Promise<UserDto>;
    /**
     * Hard-delete a user. ADMIN. Refused (409) for self, the org's last active
     * admin, or a user with review history (deactivate them instead).
     */
    remove(id: string): Promise<void>;
  };
  /** The signed-in user's own account preferences (admin/reviewer Settings). */
  me: {
    /** My account preferences. */
    preferences(): Promise<MePreferences>;
    /** Patch my account preferences. */
    updatePreferences(body: UpdateMePreferencesBody): Promise<MePreferences>;
  };
  /** BULLETINS — the per-sale memo (admin authors; managers read + acknowledge). */
  bulletins: {
    /** Admin: the project's bulletin feed (with ack rollups). */
    list(projectId: string): Promise<BulletinDto[]>;
    /** Admin: create a bulletin, with an optional PDF/image attachment. */
    create(
      projectId: string,
      body: CreateBulletinBody,
      file?: Blob | File,
    ): Promise<BulletinDto>;
    /** Admin: edit a bulletin; pass a file to replace the attachment. */
    update(
      id: string,
      body: UpdateBulletinBody,
      file?: Blob | File,
    ): Promise<BulletinDto>;
    remove(id: string): Promise<void>;
    /** Admin: who has acknowledged this bulletin (the per-manager roster). */
    acks(id: string): Promise<BulletinAckRow[]>;
    /** Manager: bulletins for my store's project, with my-ack flag. */
    mine(storeId?: string): Promise<BulletinDto[]>;
    /** Manager: acknowledge a bulletin (read receipt). */
    acknowledge(id: string, storeId?: string): Promise<void>;
    /** Manager: undo my own acknowledgement (an accidental ack isn't permanent). */
    unacknowledge(id: string, storeId?: string): Promise<void>;
  };
  /** RESOURCES — the org's training & reference library (read by everyone). */
  resources: {
    /** The whole library (pinned first, then by category). Any signed-in role. */
    list(): Promise<ResourceDto[]>;
    /** Admin: add a resource — either an external link or an uploaded file. */
    create(body: CreateResourceBody, file?: Blob | File): Promise<ResourceDto>;
    update(id: string, body: UpdateResourceBody): Promise<ResourceDto>;
    remove(id: string): Promise<void>;
  };
}

const trimSlashes = (s: string): string => s.replace(/\/+$/, "");

export function createClient(opts: CreateClientOptions): WallyClient {
  const fetchImpl: typeof fetch =
    opts.fetch ??
    (typeof fetch !== "undefined" ? fetch : undefined as unknown as typeof fetch);

  if (!fetchImpl) {
    throw new Error(
      "@wally/sdk: no global fetch available — pass `fetch` in createClient options.",
    );
  }

  const origin = trimSlashes(opts.baseUrl);
  const basePath = opts.basePath === undefined ? "/api" : opts.basePath;
  const prefix = `${origin}${basePath ? `/${trimSlashes(basePath).replace(/^\/+/, "")}` : ""}`;

  const url = (path: string): string =>
    `${prefix}/${path.replace(/^\/+/, "")}`;

  async function parseBody(res: Response): Promise<unknown> {
    const ct = res.headers.get("content-type") ?? "";
    if (res.status === 204 || res.headers.get("content-length") === "0") {
      return undefined;
    }
    if (ct.includes("application/json")) {
      try {
        return await res.json();
      } catch {
        return undefined;
      }
    }
    try {
      return await res.text();
    } catch {
      return undefined;
    }
  }

  function errorMessage(body: unknown): string | undefined {
    if (body && typeof body === "object") {
      const rec = body as Record<string, unknown>;
      const m = rec.message ?? rec.error;
      if (typeof m === "string") return m;
      if (Array.isArray(m)) return m.filter((x) => typeof x === "string").join("; ");
    }
    if (typeof body === "string" && body.trim()) return body;
    return undefined;
  }

  async function request<T>(
    method: string,
    path: string,
    init?: { json?: unknown; body?: BodyInit },
  ): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    let body: BodyInit | undefined;

    if (init?.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.json);
    } else if (init?.body !== undefined) {
      // FormData sets its own multipart boundary — do not set content-type.
      body = init.body;
    }

    const target = url(path);
    const res = await fetchImpl(target, {
      method,
      headers,
      body,
      credentials: "include",
    });

    const parsed = await parseBody(res);

    if (!res.ok) {
      throw new ApiError({
        status: res.status,
        statusText: res.statusText,
        url: target,
        body: parsed,
        message: errorMessage(parsed),
      });
    }

    return parsed as T;
  }

  const get = <T>(path: string) => request<T>("GET", path);
  const post = <T>(path: string, json?: unknown) =>
    request<T>("POST", path, json === undefined ? undefined : { json });
  const patch = <T>(path: string, json?: unknown) =>
    request<T>("PATCH", path, json === undefined ? undefined : { json });
  const put = <T>(path: string, json?: unknown) =>
    request<T>("PUT", path, json === undefined ? undefined : { json });
  const del = <T>(path: string) => request<T>("DELETE", path);

  /** Build a `?a=b&c=d` query string from defined, non-empty filters. */
  const query = (params: Record<string, string | undefined>): string => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") sp.set(k, v);
    }
    const s = sp.toString();
    return s ? `?${s}` : "";
  };

  return {
    auth: {
      me: () => get<SessionUser>("auth/me"),
      requestMagicLink: (email) =>
        post<MagicLinkResponse>("auth/magic-link", { email }),
      devLogin: (role) => post<SessionUser>("auth/dev-login", { role }),
      logout: () => post<void>("auth/logout"),
    },
    campaigns: {
      list: () => get<CampaignSummary[]>("campaigns"),
      queue: (campaignId, window) =>
        get<{ stores: StoreScore[] }>(
          `campaigns/${encodeURIComponent(campaignId)}/queue${query({
            from: window?.from,
            to: window?.to,
          })}`,
        ).then((r) => r.stores),
      sales: (campaignId, window) =>
        get<StoreSales[]>(
          `campaigns/${encodeURIComponent(campaignId)}/sales${query({
            from: window?.from,
            to: window?.to,
          })}`,
        ),
      gallery: (campaignId) =>
        get<GalleryItem[]>(
          `campaigns/${encodeURIComponent(campaignId)}/gallery`,
        ),
      turnaround: (campaignId, window) =>
        get<ComplianceTurnaround>(
          `campaigns/${encodeURIComponent(campaignId)}/turnaround${query({
            from: window?.from,
            to: window?.to,
          })}`,
        ),
      trend: (campaignId) =>
        get<ComplianceTrendPoint[]>(
          `campaigns/${encodeURIComponent(campaignId)}/trend`,
        ),
      captureSnapshot: (campaignId) =>
        post<ComplianceTrendPoint>(
          `campaigns/${encodeURIComponent(campaignId)}/snapshot`,
        ),
      deleteTrendPoint: (campaignId, dateKey) =>
        del<void>(
          `campaigns/${encodeURIComponent(campaignId)}/trend/${encodeURIComponent(dateKey)}`,
        ),
      bestInClass: (campaignId) =>
        get<BestInClassItem[]>(
          `campaigns/${encodeURIComponent(campaignId)}/best-in-class`,
        ),
      create: (body) => post<CampaignBrief>("campaigns", body),
      update: (campaignId, body) =>
        patch<CampaignBrief>(
          `campaigns/${encodeURIComponent(campaignId)}`,
          body,
        ),
      activate: (campaignId) =>
        post<CampaignBrief>(
          `campaigns/${encodeURIComponent(campaignId)}/activate`,
        ),
      close: (campaignId) =>
        post<CampaignBrief>(
          `campaigns/${encodeURIComponent(campaignId)}/close`,
        ),
      reopen: (campaignId) =>
        post<CampaignBrief>(
          `campaigns/${encodeURIComponent(campaignId)}/reopen`,
        ),
      archive: (campaignId) =>
        post<CampaignBrief>(
          `campaigns/${encodeURIComponent(campaignId)}/archive`,
        ),
      remove: (campaignId) =>
        del<void>(`campaigns/${encodeURIComponent(campaignId)}`),
      publish: (campaignId) =>
        post<PublishResult>(
          `campaigns/${encodeURIComponent(campaignId)}/publish`,
        ),
    },
    photos: {
      setBestInClass: (photoId, value) =>
        patch<{ id: string; bestInClass: boolean }>(
          `photos/${encodeURIComponent(photoId)}/best-in-class`,
          { value },
        ),
      rescore: (photoId) =>
        post<{ id: string; status: string }>(
          `photos/${encodeURIComponent(photoId)}/rescore`,
        ),
    },
    stores: {
      storeScore: (id, campaignId) =>
        get<StoreScore>(
          `stores/${encodeURIComponent(id)}/store-score?campaignId=${encodeURIComponent(campaignId)}`,
        ),
      list: () => get<StoreDto[]>("stores"),
      segments: () => get<StoreSegments>("stores/segments"),
      create: (body) => post<StoreDto>("stores", body),
      update: (id, body) =>
        patch<StoreDto>(`stores/${encodeURIComponent(id)}`, body),
      deactivate: (id) =>
        post<StoreDto>(`stores/${encodeURIComponent(id)}/deactivate`),
      reactivate: (id) =>
        post<StoreDto>(`stores/${encodeURIComponent(id)}/reactivate`),
    },
    org: {
      get: () => get<OrgDto>("org"),
      update: (body) => patch<OrgDto>("org", body),
    },
    rubrics: {
      list: (campaignId) =>
        get<Rubric[]>(`campaigns/${encodeURIComponent(campaignId)}/rubrics`),
      publish: (campaignId, body) =>
        post<Rubric>(
          `campaigns/${encodeURIComponent(campaignId)}/rubrics`,
          body,
        ),
      uploadReferenceImage: (campaignId, file) => {
        const form = new FormData();
        form.append("file", file);
        return request<UploadReferenceImageResult>(
          "POST",
          `campaigns/${encodeURIComponent(campaignId)}/rubrics/reference-image`,
          { body: form },
        );
      },
      activate: (campaignId, fixtureKey, version) =>
        post<Rubric>(
          `campaigns/${encodeURIComponent(campaignId)}/rubrics/${encodeURIComponent(fixtureKey)}/activate`,
          { version },
        ),
    },
    submissions: {
      current: () =>
        get<{ submissionId: string; campaignKey: string }>("submissions/current"),
      get: (id) => get<Submission>(`submissions/${encodeURIComponent(id)}`),
      uploadPhoto: (submissionId, fixtureKey, file) => {
        const form = new FormData();
        form.append("fixtureKey", fixtureKey);
        form.append("file", file);
        return request<UploadedPhoto>(
          "POST",
          `submissions/${encodeURIComponent(submissionId)}/photos`,
          { body: form },
        );
      },
    },
    verdicts: {
      review: (id, body) =>
        post<ReviewResult>(
          `verdicts/${encodeURIComponent(id)}/review`,
          body,
        ),
    },
    reports: {
      url: (storeId) =>
        get<ReportUrl>(`reports/${encodeURIComponent(storeId)}/url`),
    },
    fixtures: {
      list: (projectId) => get<Fixture[]>(`fixtures${query({ projectId })}`),
      create: (input) => post<Fixture>("fixtures", input),
      update: (id, body) =>
        patch<Fixture>(`fixtures/${encodeURIComponent(id)}`, body),
      usage: (id) =>
        get<FixtureUsage>(`fixtures/${encodeURIComponent(id)}/usage`),
      archive: (id) =>
        post<void>(`fixtures/${encodeURIComponent(id)}/archive`),
      remove: (id) => del<void>(`fixtures/${encodeURIComponent(id)}`),
      products: {
        list: (fixtureId) =>
          get<FixtureDefaultProduct[]>(
            `fixtures/${encodeURIComponent(fixtureId)}/products`,
          ),
        add: (fixtureId, productId, row) =>
          post<void>(`fixtures/${encodeURIComponent(fixtureId)}/products`, {
            productId,
            ...(row ? { row } : {}),
          }),
        remove: (fixtureId, fixtureProductId) =>
          del<void>(
            `fixtures/${encodeURIComponent(fixtureId)}/products/${encodeURIComponent(fixtureProductId)}`,
          ),
        reorder: (fixtureId, body) =>
          patch<FixtureDefaultProduct[]>(
            `fixtures/${encodeURIComponent(fixtureId)}/planogram`,
            {
              // The editor speaks `merchandiseIds`; the library endpoint wants
              // `fixtureProductIds`. Same values (the facing ids), renamed.
              shelves: body.shelves.map((s) => ({
                row: s.row,
                fixtureProductIds: s.merchandiseIds,
              })),
            },
          ),
      },
    },
    floorplan: {
      get: (campaignId, storeId) =>
        get<FloorPlan>(
          `campaigns/${encodeURIComponent(campaignId)}/stores/${encodeURIComponent(storeId)}/floorplan`,
        ),
      copyLayout: (campaignId, fromStoreId, toStoreId) =>
        post<FloorPlan>(
          `campaigns/${encodeURIComponent(campaignId)}/stores/${encodeURIComponent(toStoreId)}/copy-layout`,
          { fromStoreId },
        ),
    },
    moneyMap: {
      get: (campaignId, storeId) =>
        get<MoneyMap>(
          `campaigns/${encodeURIComponent(campaignId)}/stores/${encodeURIComponent(storeId)}/money-map`,
        ),
    },
    placements: {
      move: (id, body) =>
        patch<void>(`placements/${encodeURIComponent(id)}`, body),
      patch: (id, body) =>
        patch<void>(`placements/${encodeURIComponent(id)}`, body),
      create: (campaignId, storeId, body) =>
        post<PlacedFixture>(
          `campaigns/${encodeURIComponent(campaignId)}/stores/${encodeURIComponent(storeId)}/placements`,
          body,
        ),
      remove: (id) => del<void>(`placements/${encodeURIComponent(id)}`),
    },
    projects: {
      list: (includeArchived) =>
        get<ProjectDto[]>(
          `projects${query({
            includeArchived: includeArchived ? "true" : undefined,
          })}`,
        ),
      get: (id) => get<ProjectDto>(`projects/${encodeURIComponent(id)}`),
      create: (body) => post<ProjectDto>("projects", body),
      update: (id, body) =>
        patch<ProjectDto>(`projects/${encodeURIComponent(id)}`, body),
      archive: (id) =>
        post<ProjectDto>(`projects/${encodeURIComponent(id)}/archive`),
      unarchive: (id) =>
        post<ProjectDto>(`projects/${encodeURIComponent(id)}/unarchive`),
      remove: (id) => del<void>(`projects/${encodeURIComponent(id)}`),
      venues: (id) =>
        get<ProjectVenue[]>(`projects/${encodeURIComponent(id)}/venues`),
    },
    guideFixtures: {
      detail: (campaignId, fixtureId) =>
        get<GuideFixtureDetail>(
          `campaigns/${encodeURIComponent(campaignId)}/fixtures/${encodeURIComponent(fixtureId)}/detail`,
        ),
      saveNotes: (id, notes) =>
        patch<void>(`guide-fixtures/${encodeURIComponent(id)}`, { notes }),
      prepopulate: (campaignId, fixtureId) =>
        post<GuideFixtureDetail>(
          `campaigns/${encodeURIComponent(campaignId)}/fixtures/${encodeURIComponent(fixtureId)}/prepopulate`,
        ),
      addMerchandise: (guideFixtureId, productId, row) =>
        post<void>(
          `guide-fixtures/${encodeURIComponent(guideFixtureId)}/merchandise`,
          { productId, ...(row ? { row } : {}) },
        ),
      removeMerchandise: (guideFixtureId, merchandiseId) =>
        del<void>(
          `guide-fixtures/${encodeURIComponent(guideFixtureId)}/merchandise/${encodeURIComponent(merchandiseId)}`,
        ),
      reorderPlanogram: (guideFixtureId, body) =>
        patch<GuideFixtureDetail>(
          `guide-fixtures/${encodeURIComponent(guideFixtureId)}/planogram`,
          body,
        ),
      addExampleImage: (guideFixtureId, file, caption) => {
        const form = new FormData();
        form.append("file", file);
        if (caption !== undefined && caption !== "")
          form.append("caption", caption);
        return request<GuideFixtureDetail>(
          "POST",
          `guide-fixtures/${encodeURIComponent(guideFixtureId)}/example-images`,
          { body: form },
        );
      },
      updateExampleImageCaption: (guideFixtureId, imageId, caption) =>
        patch<GuideFixtureDetail>(
          `guide-fixtures/${encodeURIComponent(guideFixtureId)}/example-images/${encodeURIComponent(imageId)}`,
          { caption },
        ),
      setExampleImageBestInClass: (guideFixtureId, imageId) =>
        post<GuideFixtureDetail>(
          `guide-fixtures/${encodeURIComponent(guideFixtureId)}/example-images/${encodeURIComponent(imageId)}/best-in-class`,
        ),
      removeExampleImage: (guideFixtureId, imageId) =>
        del<GuideFixtureDetail>(
          `guide-fixtures/${encodeURIComponent(guideFixtureId)}/example-images/${encodeURIComponent(imageId)}`,
        ),
    },
    products: {
      list: (filters) =>
        get<ProductDto[]>(
          `products${query({
            search: filters?.search,
            brand: filters?.brand,
            category: filters?.category,
            color: filters?.color,
            includeArchived: filters?.includeArchived ? "true" : undefined,
          })}`,
        ),
      create: (body) => post<ProductDto>("products", body),
      update: (id, body) =>
        patch<ProductDto>(`products/${encodeURIComponent(id)}`, body),
      archive: (id) =>
        post<ProductDto>(`products/${encodeURIComponent(id)}/archive`),
      unarchive: (id) =>
        post<ProductDto>(`products/${encodeURIComponent(id)}/unarchive`),
      remove: (id) => del<void>(`products/${encodeURIComponent(id)}`),
    },
    manager: {
      home: (storeId) =>
        get<ManagerHome>(`manager/home${query({ storeId })}`),
      tasks: (storeId) =>
        get<TaskDto[]>(`manager/tasks${query({ storeId })}`),
      completeTask: (taskId, storeId) =>
        post<void>(
          `manager/tasks/${encodeURIComponent(taskId)}/complete${query({ storeId })}`,
        ),
      reopenTask: (taskId, storeId) =>
        post<void>(
          `manager/tasks/${encodeURIComponent(taskId)}/reopen${query({ storeId })}`,
        ),
      markTasksSeen: (storeId) =>
        post<void>(`manager/tasks/seen${query({ storeId })}`),
      preferences: () => get<ManagerPreferences>("manager/preferences"),
      updatePreferences: (body) =>
        patch<ManagerPreferences>("manager/preferences", body),
      fixtures: (storeId) =>
        get<ManagerFixture[]>(`manager/fixtures${query({ storeId })}`),
      products: (storeId) =>
        get<ProductDto[]>(`manager/products${query({ storeId })}`),
      salesLog: (storeId, date) =>
        get<SalesLog>(`manager/sales${query({ storeId, date })}`),
      logSale: (productId, units, storeId, date) =>
        put<void>(
          `manager/sales/${encodeURIComponent(productId)}${query({ storeId })}`,
          { units, ...(date ? { date } : {}) },
        ),
      compliance: (storeId) =>
        get<FixtureCompliance[]>(`manager/compliance${query({ storeId })}`),
      fixtureCompliance: (fixtureId, storeId) =>
        get<FixtureComplianceDetail>(
          `manager/fixtures/${encodeURIComponent(fixtureId)}/compliance${query({ storeId })}`,
        ),
      uploadFixturePhoto: (fixtureId, file, storeId) => {
        const form = new FormData();
        form.append("file", file);
        return request<FixtureComplianceDetail>(
          "POST",
          `manager/fixtures/${encodeURIComponent(fixtureId)}/photo${query({ storeId })}`,
          { body: form },
        );
      },
      requestCapturePhoto: (fixtureId, storeId) =>
        post<FixtureComplianceDetail>(
          `manager/fixtures/${encodeURIComponent(fixtureId)}/request-photo${query({ storeId })}`,
        ),
      overrideCapture: (fixtureId, body, storeId) =>
        post<FixtureComplianceDetail>(
          `manager/fixtures/${encodeURIComponent(fixtureId)}/override${query({ storeId })}`,
          body,
        ),
    },
    adminTasks: {
      create: (storeId, body) =>
        post<TaskDto>(
          `admin/stores/${encodeURIComponent(storeId)}/tasks`,
          body,
        ),
      bulkCreate: (body) =>
        post<{ created: number }>("admin/tasks/bulk", body),
      list: (storeId) =>
        get<AdminTaskDto[]>(`admin/tasks${query({ storeId })}`),
      update: (id, body) =>
        patch<TaskDto>(`admin/tasks/${encodeURIComponent(id)}`, body),
      remove: (id) => del<void>(`admin/tasks/${encodeURIComponent(id)}`),
    },
    adminUsers: {
      list: () => get<UserDto[]>("admin/users"),
      invite: (body) => post<UserDto>("admin/users/invite", body),
      update: (id, body) =>
        patch<UserDto>(`admin/users/${encodeURIComponent(id)}`, body),
      remove: (id) => del<void>(`admin/users/${encodeURIComponent(id)}`),
    },
    me: {
      preferences: () => get<MePreferences>("me/preferences"),
      updatePreferences: (body) =>
        patch<MePreferences>("me/preferences", body),
    },
    bulletins: {
      list: (projectId) =>
        get<BulletinDto[]>(
          `projects/${encodeURIComponent(projectId)}/bulletins`,
        ),
      create: (projectId, body, file) => {
        const form = new FormData();
        form.append("title", body.title);
        if (body.body !== undefined) form.append("body", body.body);
        if (body.startsAt) form.append("startsAt", body.startsAt);
        if (body.endsAt) form.append("endsAt", body.endsAt);
        if (body.pinned !== undefined) form.append("pinned", String(body.pinned));
        if (body.publish !== undefined) form.append("publish", String(body.publish));
        if (file) form.append("file", file);
        return request<BulletinDto>(
          "POST",
          `projects/${encodeURIComponent(projectId)}/bulletins`,
          { body: form },
        );
      },
      update: (id, body, file) => {
        // Multipart (mirrors create) so the PATCH route's FileInterceptor can
        // carry a replacement attachment alongside the edited fields. Multipart
        // text fields arrive as strings; the API coerces them.
        const form = new FormData();
        if (body.title !== undefined) form.append("title", body.title);
        if (body.body !== undefined) form.append("body", body.body);
        // null clears the date; "" tells the API to leave it untouched isn't a
        // case here — only send the field when the caller set it.
        if (body.startsAt !== undefined)
          form.append("startsAt", body.startsAt ?? "");
        if (body.endsAt !== undefined) form.append("endsAt", body.endsAt ?? "");
        if (body.pinned !== undefined) form.append("pinned", String(body.pinned));
        if (body.publish !== undefined)
          form.append("publish", String(body.publish));
        if (body.removeAttachment !== undefined)
          form.append("removeAttachment", String(body.removeAttachment));
        if (file) form.append("file", file);
        return request<BulletinDto>(
          "PATCH",
          `bulletins/${encodeURIComponent(id)}`,
          { body: form },
        );
      },
      remove: (id) => del<void>(`bulletins/${encodeURIComponent(id)}`),
      acks: (id) =>
        get<BulletinAckRow[]>(`bulletins/${encodeURIComponent(id)}/acks`),
      mine: (storeId) =>
        get<BulletinDto[]>(`manager/bulletins${query({ storeId })}`),
      acknowledge: (id, storeId) =>
        post<void>(
          `manager/bulletins/${encodeURIComponent(id)}/ack${query({ storeId })}`,
        ),
      unacknowledge: (id, storeId) =>
        del<void>(
          `manager/bulletins/${encodeURIComponent(id)}/ack${query({ storeId })}`,
        ),
    },
    resources: {
      list: () => get<ResourceDto[]>("resources"),
      create: (body, file) => {
        const form = new FormData();
        form.append("title", body.title);
        if (body.description !== undefined)
          form.append("description", body.description);
        if (body.category !== undefined) form.append("category", body.category);
        if (body.subtopic !== undefined) form.append("subtopic", body.subtopic);
        if (body.url) form.append("url", body.url);
        if (body.pinned !== undefined) form.append("pinned", String(body.pinned));
        if (file) form.append("file", file);
        return request<ResourceDto>("POST", "resources", { body: form });
      },
      update: (id, body) =>
        patch<ResourceDto>(`resources/${encodeURIComponent(id)}`, body),
      remove: (id) => del<void>(`resources/${encodeURIComponent(id)}`),
    },
  };
}

export type {
  ScoreResult,
  StoreScore,
  StoreSales,
  ComplianceTurnaround,
  ComplianceTrendPoint,
  SnapshotSource,
  SessionUser,
  Role,
  Fixture,
  FixtureKind,
  Department,
  PlacedFixture,
  FloorPlan,
  ProductDto,
  MerchandiseRow,
  MerchandiseItem,
  GuideFixtureDetail,
  GuideFixtureExampleImage,
  MoneyMap,
  MoneyFixture,
  ManagerHome,
  ManagerFixture,
  ManagerPreferences,
  MePreferences,
  SalesLog,
  SalesLine,
  SalesFixtureGroup,
  TaskDto,
  AdminTaskDto,
  TaskKind,
  TaskStatus,
  FixtureCompliance,
  FixtureComplianceDetail,
  CaptureVerdict,
  CaptureAttempt,
  ComplianceIssue,
  IssueBox,
  OverrideCaptureBody,
  ComplianceState,
  ProjectDto,
  ProjectKind,
  ProjectVenue,
  BulletinDto,
  BulletinAckRow,
  BulletinScheduleState,
  ResourceDto,
} from "@wally/types";

export default createClient;
