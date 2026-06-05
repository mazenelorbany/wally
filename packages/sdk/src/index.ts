// @wally/sdk — typed API client for the Wally backend.
//
// Pure runtime over `fetch`. Returns the shared contract shapes from
// `@wally/types`. Used by the web app (Vite/ESM) and any Node tooling.
// Cookie-session auth: every request sends `credentials: 'include'` so the
// browser attaches the `wally_session` cookie set by the API.

import type {
  ScoreResult,
  StoreScore,
  ComplianceTurnaround,
  ComplianceTrendPoint,
  BestInClassItem,
  SessionUser,
  Role,
  Fixture,
  FixtureKind,
  FixtureUsage,
  FixtureDefaultProduct,
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
  SalesLog,
  TaskDto,
  TaskKind,
  FixtureCompliance,
  FixtureComplianceDetail,
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

export interface CampaignSummary {
  id: string;
  key: string;
  name: string;
  status: string;
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

export interface SubmissionPhoto {
  id: string;
  fixtureKey: string;
  status: string;
  /** Signed, time-limited URL — never the raw storage key. */
  url?: string;
  score?: ScoreResult;
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

/** Optional filters for the merchandising catalog. */
export interface ProductFilters {
  search?: string;
  brand?: string;
  category?: string;
  color?: string;
}

/* ---- STORE MANAGER ---- */

/** Body for an admin assigning a task to a store's manager. */
export interface CreateTaskBody {
  kind: TaskKind;
  title: string;
  body?: string;
  fixtureKey?: string;
  dueAt?: string;
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
    /** The reviewer queue: one rolled-up StoreScore per store, attention-first. */
    queue(campaignId: string): Promise<StoreScore[]>;
    /** Every execution image across the campaign's stores (the gallery). */
    gallery(campaignId: string): Promise<GalleryItem[]>;
    /** Operational turnaround: review speed + rework hot-spots. */
    turnaround(campaignId: string): Promise<ComplianceTurnaround>;
    /** Compliance snapshots over time (the trend chart). */
    trend(campaignId: string): Promise<ComplianceTrendPoint[]>;
    /** Capture today's compliance as a snapshot now (ADMIN). */
    captureSnapshot(campaignId: string): Promise<ComplianceTrendPoint>;
    /** Best-in-class execution photos to showcase to other stores. */
    bestInClass(campaignId: string): Promise<BestInClassItem[]>;
  };
  /** Toggle the best-in-class flag on a store execution photo. */
  photos: {
    setBestInClass(
      photoId: string,
      value: boolean,
    ): Promise<{ id: string; bestInClass: boolean }>;
  };
  stores: {
    storeScore(id: string, campaignId: string): Promise<StoreScore>;
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
    list(): Promise<Fixture[]>;
    create(input: { name: string; kind?: FixtureKind }): Promise<Fixture>;
    /** Where a fixture is used (stores + guides) — for the delete dialog. */
    usage(id: string): Promise<FixtureUsage>;
    /** Soft-delete: hide from the library, keep placements. */
    archive(id: string): Promise<void>;
    /** Hard-delete: remove the fixture and everything that hangs off it. */
    remove(id: string): Promise<void>;
    /** The fixture's default product set (its reusable starter list). */
    products: {
      list(fixtureId: string): Promise<FixtureDefaultProduct[]>;
      add(fixtureId: string, productId: string): Promise<void>;
      remove(fixtureId: string, fixtureProductId: string): Promise<void>;
    };
  };
  /** CREATE GUIDE — a store's floor plan for a campaign. */
  floorplan: {
    get(campaignId: string, storeId: string): Promise<FloorPlan>;
  };
  /** MONEY MAP — a store's floor plan recoloured by fixture revenue. */
  moneyMap: {
    get(campaignId: string, storeId: string): Promise<MoneyMap>;
  };
  /** CREATE GUIDE — move/resize a placed fixture on a floor plan. */
  placements: {
    move(id: string, body: PlacementMoveBody): Promise<void>;
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
    list(): Promise<ProjectDto[]>;
    get(id: string): Promise<ProjectDto>;
    create(body: CreateProjectBody): Promise<ProjectDto>;
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
  };
  /** CREATE GUIDE — the merchandising catalog. */
  products: {
    list(filters?: ProductFilters): Promise<ProductDto[]>;
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
    completeTask(taskId: string): Promise<void>;
    /** Mark every open task as seen (clears the notification badge). */
    markTasksSeen(storeId?: string): Promise<void>;
    fixtures(storeId?: string): Promise<ManagerFixture[]>;
    products(storeId?: string): Promise<ProductDto[]>;
    salesLog(storeId?: string): Promise<SalesLog>;
    /** Set the units sold for one product (idempotent upsert). */
    logSale(productId: string, units: number, storeId?: string): Promise<void>;
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
  };
  /** ADMIN — assign a task to a store's manager. */
  adminTasks: {
    create(storeId: string, body: CreateTaskBody): Promise<TaskDto>;
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
      queue: (campaignId) =>
        get<{ stores: StoreScore[] }>(
          `campaigns/${encodeURIComponent(campaignId)}/queue`,
        ).then((r) => r.stores),
      gallery: (campaignId) =>
        get<GalleryItem[]>(
          `campaigns/${encodeURIComponent(campaignId)}/gallery`,
        ),
      turnaround: (campaignId) =>
        get<ComplianceTurnaround>(
          `campaigns/${encodeURIComponent(campaignId)}/turnaround`,
        ),
      trend: (campaignId) =>
        get<ComplianceTrendPoint[]>(
          `campaigns/${encodeURIComponent(campaignId)}/trend`,
        ),
      captureSnapshot: (campaignId) =>
        post<ComplianceTrendPoint>(
          `campaigns/${encodeURIComponent(campaignId)}/snapshot`,
        ),
      bestInClass: (campaignId) =>
        get<BestInClassItem[]>(
          `campaigns/${encodeURIComponent(campaignId)}/best-in-class`,
        ),
    },
    photos: {
      setBestInClass: (photoId, value) =>
        patch<{ id: string; bestInClass: boolean }>(
          `photos/${encodeURIComponent(photoId)}/best-in-class`,
          { value },
        ),
    },
    stores: {
      storeScore: (id, campaignId) =>
        get<StoreScore>(
          `stores/${encodeURIComponent(id)}/store-score?campaignId=${encodeURIComponent(campaignId)}`,
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
      list: () => get<Fixture[]>("fixtures"),
      create: (input) => post<Fixture>("fixtures", input),
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
        add: (fixtureId, productId) =>
          post<void>(`fixtures/${encodeURIComponent(fixtureId)}/products`, {
            productId,
          }),
        remove: (fixtureId, fixtureProductId) =>
          del<void>(
            `fixtures/${encodeURIComponent(fixtureId)}/products/${encodeURIComponent(fixtureProductId)}`,
          ),
      },
    },
    floorplan: {
      get: (campaignId, storeId) =>
        get<FloorPlan>(
          `campaigns/${encodeURIComponent(campaignId)}/stores/${encodeURIComponent(storeId)}/floorplan`,
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
      create: (campaignId, storeId, body) =>
        post<PlacedFixture>(
          `campaigns/${encodeURIComponent(campaignId)}/stores/${encodeURIComponent(storeId)}/placements`,
          body,
        ),
      remove: (id) => del<void>(`placements/${encodeURIComponent(id)}`),
    },
    projects: {
      list: () => get<ProjectDto[]>("projects"),
      get: (id) => get<ProjectDto>(`projects/${encodeURIComponent(id)}`),
      create: (body) => post<ProjectDto>("projects", body),
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
    },
    products: {
      list: (filters) =>
        get<ProductDto[]>(
          `products${query({
            search: filters?.search,
            brand: filters?.brand,
            category: filters?.category,
            color: filters?.color,
          })}`,
        ),
    },
    manager: {
      home: (storeId) =>
        get<ManagerHome>(`manager/home${query({ storeId })}`),
      tasks: (storeId) =>
        get<TaskDto[]>(`manager/tasks${query({ storeId })}`),
      completeTask: (taskId) =>
        post<void>(`manager/tasks/${encodeURIComponent(taskId)}/complete`),
      markTasksSeen: (storeId) =>
        post<void>(`manager/tasks/seen${query({ storeId })}`),
      fixtures: (storeId) =>
        get<ManagerFixture[]>(`manager/fixtures${query({ storeId })}`),
      products: (storeId) =>
        get<ProductDto[]>(`manager/products${query({ storeId })}`),
      salesLog: (storeId) =>
        get<SalesLog>(`manager/sales${query({ storeId })}`),
      logSale: (productId, units, storeId) =>
        put<void>(
          `manager/sales/${encodeURIComponent(productId)}${query({ storeId })}`,
          { units },
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
    },
    adminTasks: {
      create: (storeId, body) =>
        post<TaskDto>(
          `admin/stores/${encodeURIComponent(storeId)}/tasks`,
          body,
        ),
    },
  };
}

export type {
  ScoreResult,
  StoreScore,
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
  SalesLog,
  SalesLine,
  SalesFixtureGroup,
  TaskDto,
  TaskKind,
  TaskStatus,
  FixtureCompliance,
  FixtureComplianceDetail,
  CaptureVerdict,
  ComplianceState,
  ProjectDto,
  ProjectKind,
  ProjectVenue,
} from "@wally/types";

export default createClient;
