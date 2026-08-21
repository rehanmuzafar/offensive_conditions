/**
 * Typed fetch client for the OFFCON API gateway.
 *
 * In the browser we hit a same-origin "/api/*" path which Next rewrites to the
 * gateway (see next.config.mjs) — this dodges CORS in dev and keeps one origin
 * in prod. The access token is attached from the auth store when present.
 *
 * Every error is normalised into an `ApiError` carrying the gateway's
 * structured `{ code, message, details }` body so callers can branch on
 * `err.code` instead of parsing strings.
 */

export const API_PREFIX = "/api";

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message || `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code || "UNKNOWN";
    this.details = body.details;
  }
}

type TokenGetter = () => string | null;
let getToken: TokenGetter = () => null;

/** Wire the token source (called once from the auth provider). */
export function setTokenGetter(fn: TokenGetter): void {
  getToken = fn;
}

/**
 * Refreshes the access token and returns the new one, or null if the session
 * is truly over. Injected from the auth provider so this module stays free of
 * a circular import on auth-api.
 */
type TokenRefresher = () => Promise<string | null>;
let refreshToken: TokenRefresher = async () => null;

export function setTokenRefresher(fn: TokenRefresher): void {
  refreshToken = fn;
}

/**
 * Access tokens live 15 minutes. Filling in a long form (a CTF event, a
 * challenge) easily outlasts that, and every request then failed with
 * "token expired" — losing whatever the user had typed.
 *
 * A 401 now triggers one refresh and one replay. Concurrent 401s share a single
 * refresh so a page with several queries does not fire N refreshes and trip the
 * service's token-reuse detection, which would revoke the whole family.
 */
let inFlightRefresh: Promise<string | null> | null = null;

function refreshOnce(): Promise<string | null> {
  if (!inFlightRefresh) {
    inFlightRefresh = refreshToken().finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  /** JSON body — serialized automatically. Use `rawBody` for FormData etc. */
  body?: unknown;
  rawBody?: BodyInit;
  /** Skip attaching the Authorization header (for public endpoints). */
  anonymous?: boolean;
  /** Querystring params. */
  params?: Record<string, string | number | boolean | undefined | null>;
}

function buildUrl(path: string, params?: RequestOptions["params"]): string {
  const base = path.startsWith("/") ? path : `/${path}`;
  const url = `${API_PREFIX}${base}`;
  if (!params) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.append(k, String(v));
  }
  const s = qs.toString();
  return s ? `${url}?${s}` : url;
}

/**
 * Fetch a protected file as a blob.
 *
 * The JSON helper parses every response, and a PDF is not JSON. This exists so
 * an authenticated file — a writeup, say — can be read in the browser: an
 * `<iframe src=…>` carries no Authorization header, so the bytes have to be
 * fetched here and handed on as an object URL.
 */
export async function fetchBlob(
  path: string,
): Promise<{ blob: Blob; contentType: string; kind: string }> {
  const headers = new Headers({ Accept: "*/*" });
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(buildUrl(path), { headers, credentials: "include" });
  if (!res.ok) {
    throw new ApiError(res.status, {
      code: "FILE_UNREADABLE",
      message: `Could not load that file (${res.status})`,
    });
  }
  return {
    blob: await res.blob(),
    contentType: res.headers.get("Content-Type") ?? "application/octet-stream",
    // Set by ctf-svc: pdf | markdown | text — how the page should show it.
    kind: res.headers.get("X-Writeup-Kind") ?? "text",
  };
}

async function request<T>(
  method: string,
  path: string,
  opts: RequestOptions = {},
  isRetry = false,
): Promise<T> {
  const headers = new Headers(opts.headers);
  headers.set("Accept", "application/json");

  let body: BodyInit | undefined;
  if (opts.rawBody !== undefined) {
    body = opts.rawBody;
  } else if (opts.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(opts.body);
  }

  if (!opts.anonymous) {
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(buildUrl(path, opts.params), {
    ...opts,
    method,
    headers,
    body,
    credentials: "include",
  });

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await res.json().catch(() => null) : await res.text();

  // Expired access token: refresh once, then replay the original request.
  if (res.status === 401 && !opts.anonymous && !isRetry) {
    const fresh = await refreshOnce();
    if (fresh) return request<T>(method, path, opts, true);
  }

  if (!res.ok) {
    const errBody: ApiErrorBody =
      isJson && payload && typeof payload === "object" && "error" in payload
        ? (payload as { error: ApiErrorBody }).error
        : { code: "HTTP_ERROR", message: typeof payload === "string" ? payload : "Request failed" };
    throw new ApiError(res.status, errBody);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>("GET", path, opts),
  post: <T>(path: string, opts?: RequestOptions) => request<T>("POST", path, opts),
  put: <T>(path: string, opts?: RequestOptions) => request<T>("PUT", path, opts),
  patch: <T>(path: string, opts?: RequestOptions) => request<T>("PATCH", path, opts),
  delete: <T>(path: string, opts?: RequestOptions) => request<T>("DELETE", path, opts),
};
