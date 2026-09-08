/**
 * Talking to the engine (ADR 0044).
 *
 * One place, because the two things every call needs are easy to forget in
 * forty places: the cookie has to be sent, and a 401 means the session ended
 * and the answer is the sign-in page rather than an error message.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: { path?: string; message?: string }[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    // Same origin in production and behind the dev proxy, so the session cookie
    // travels without anything else being arranged.
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (response.status === 401) {
    // Not an error to render. The session is gone, and the only useful next
    // screen is the one that mints a new one.
    window.location.assign("/admin/login");
    throw new ApiError(401, "Sign in to continue.");
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof payload["detail"] === "string" ? payload["detail"] : response.statusText,
      Array.isArray(payload["issues"]) ? (payload["issues"] as { message?: string }[]) : [],
    );
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

// ── What the engine answers with ─────────────────────────────────────────────

export interface Status {
  site: { name: string; pages: number; types: number } | null;
  counts: Record<string, number>;
  lastChange: { seq: number; actor: string; source: string; summary: string; at: string } | null;
}

export interface Entry {
  id: string;
  slug: string | null;
  status: string;
  data: Record<string, unknown>;
  updatedAt: string;
}

export interface Field {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  values?: string[];
  to?: string;
}

export interface ContentType {
  key: string;
  label: string;
  labelPlural?: string;
  titleField?: string;
  derived?: unknown;
  fields: Field[];
}

export interface Spec {
  name: string;
  content: ContentType[];
  pages: { key: string; path: string; title: string }[];
}
