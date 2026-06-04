// @wally/sdk — typed API client for the Wally backend.
//
// Pure runtime over `fetch`. Returns the shared contract shapes from
// `@wally/types`. Used by the web app (Vite/ESM) and any Node tooling.
// Cookie-session auth: every request sends `credentials: 'include'` so the
// browser attaches the `wally_session` cookie set by the API.

import type {
  ScoreResult,
  StoreScore,
  SessionUser,
  Role,
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
  photos: SubmissionPhoto[];
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
  };
  stores: {
    storeScore(id: string, campaignId: string): Promise<StoreScore>;
  };
  submissions: {
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
    },
    stores: {
      storeScore: (id, campaignId) =>
        get<StoreScore>(
          `stores/${encodeURIComponent(id)}/store-score?campaignId=${encodeURIComponent(campaignId)}`,
        ),
    },
    submissions: {
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
  };
}

export type { ScoreResult, StoreScore, SessionUser, Role } from "@wally/types";

export default createClient;
