/**
 * `@forinda-cms/sdk` — the client boundary from ADR 0002 seam 4.
 *
 * *"The CLI talks to the platform through a client library, not through
 * internals. Phase 1's MCP server is then a second consumer rather than a
 * rewrite."* Everything a machine can do to a site goes through this file, which
 * means the surface stays enumerable — and the CLI cannot quietly grow a
 * privileged path to the database, because it does not depend on one.
 *
 * No HTTP library: `fetch` is in every Node this project supports, and a
 * dependency here is a dependency in every consumer.
 */
import type { SiteSpec, SpecChange } from "@forinda-cms/spec";

export * from "./config.js";

export interface Session {
  readonly token: string;
  readonly expiresAt: string;
  readonly owner: { readonly email: string };
}

export interface Status {
  readonly site: { readonly name: string; readonly pages: number; readonly types: number } | null;
  readonly counts: Record<string, number>;
  readonly lastChange: {
    readonly seq: number;
    readonly actor: string;
    readonly source: string;
    readonly classification: string;
    readonly summary: string;
    readonly at: string;
  } | null;
}

export interface MigrationSummary {
  readonly kind: string;
  readonly statement: string;
}

export interface Plan {
  /** True when the site has no spec yet: a first publish, not a diff. */
  readonly initial: boolean;
  readonly changes: readonly SpecChange[];
  readonly destructive: number;
  readonly migration: readonly MigrationSummary[];
}

export interface HistoryEntry {
  readonly seq: number;
  readonly actor: string;
  readonly source: string;
  readonly classification: string;
  readonly summary: string;
  readonly at: string;
  readonly reverted: boolean;
}

export interface Entry {
  readonly id: string;
  readonly slug: string | null;
  readonly status: string;
  readonly data: Record<string, unknown>;
  readonly updatedAt: string;
}

export interface EntryInput {
  readonly data: Record<string, unknown>;
  readonly slug?: string | undefined;
  readonly status?: "draft" | "published" | undefined;
}

export interface Applied {
  readonly seq: number;
  readonly changes: readonly SpecChange[];
  readonly migration: readonly MigrationSummary[];
}

/**
 * A failed request, with the server's own words.
 *
 * Carries `status` so a caller can act on the difference that matters:
 * 401 means sign in, 409 means the destructive gate refused and the same call
 * with confirmation would succeed.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: readonly { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** The destructive gate, which a caller resolves rather than reports. */
  get needsConfirmation(): boolean {
    return this.status === 409;
  }

  get unauthorized(): boolean {
    return this.status === 401;
  }
}

/**
 * The server's own words, from an RFC 9457 problem body.
 *
 * `detail` and `errors` are what the framework emits — reading `message` and
 * `issues` instead meant every failure reached the caller as
 * "POST /api/apply failed with 409", throwing away both the reason and the
 * field-level errors. A generic message is worse than none: it reads like a
 * transport problem rather than the refusal it is.
 */
function problem(payload: unknown, status: number, what: string): ApiError {
  const body = (payload ?? {}) as {
    detail?: unknown;
    title?: unknown;
    errors?: unknown;
  };

  const message =
    typeof body.detail === "string" && body.detail !== ""
      ? body.detail
      : typeof body.title === "string" && body.title !== ""
        ? body.title
        : `${what} failed with ${status}`;

  const issues = Array.isArray(body.errors)
    ? body.errors.flatMap((entry) => {
        const issue = entry as { path?: unknown; field?: unknown; message?: unknown };
        const path = typeof issue.path === "string" ? issue.path : issue.field;
        return typeof path === "string" && typeof issue.message === "string"
          ? [{ path, message: issue.message }]
          : [];
      })
    : [];

  return new ApiError(status, message, issues);
}

export interface ClientOptions {
  readonly url: string;
  readonly token?: string | undefined;
  /**
   * Which surface this client is, recorded on every change it makes.
   *
   * `fcms` passes `cli`, the MCP server passes `mcp`. History is meant to answer
   * "what did the model change" as a query (ADR 0015 §5), and it only can if
   * each door names itself.
   */
  readonly source?: "cli" | "mcp" | "chat" | "canvas" | "api";
  /** Injectable so tests do not need a listening socket. */
  readonly fetch?: typeof globalThis.fetch;
}

export class Client {
  private readonly base: string;
  private readonly token: string | undefined;
  private readonly source: string;
  private readonly http: typeof globalThis.fetch;

  constructor(options: ClientOptions) {
    // One trailing slash difference otherwise becomes `//api/status`, which
    // some proxies answer and some redirect.
    this.base = options.url.replace(/\/+$/, "");
    this.token = options.token;
    this.source = options.source ?? "api";
    this.http = options.fetch ?? globalThis.fetch;
  }

  /** Exchange a password for a session token. */
  login(email: string, password: string): Promise<Session> {
    return this.request<Session>("POST", "/api/login", { email, password });
  }

  status(): Promise<Status> {
    return this.request<Status>("GET", "/api/status");
  }

  /** The stored spec, for `fcms pull` to print as canonical files. */
  async spec(): Promise<SiteSpec> {
    const { spec } = await this.request<{ spec: SiteSpec }>("GET", "/api/spec");
    return spec;
  }

  plan(spec: SiteSpec): Promise<Plan> {
    return this.request<Plan>("POST", "/api/plan", { spec });
  }

  apply(spec: SiteSpec, options: { allowDestructive?: boolean } = {}): Promise<Applied> {
    return this.request<Applied>("POST", "/api/apply", {
      spec,
      allowDestructive: options.allowDestructive === true,
      source: this.source,
    });
  }

  history(limit = 20): Promise<readonly HistoryEntry[]> {
    return this.request<{ history: HistoryEntry[] }>("GET", `/api/history?limit=${limit}`).then(
      (r) => r.history,
    );
  }

  /** The last patch, reversed — a table lookup, because the inverse was stored. */
  undo(): Promise<{ seq: number }> {
    return this.request<{ seq: number }>("POST", "/api/undo");
  }

  entries(typeKey: string): Promise<readonly Entry[]> {
    return this.request<{ entries: Entry[] }>(
      "GET",
      `/api/entries/${encodeURIComponent(typeKey)}`,
    ).then((r) => r.entries);
  }

  createEntry(typeKey: string, input: EntryInput): Promise<Entry> {
    return this.request<{ entry: Entry }>(
      "POST",
      `/api/entries/${encodeURIComponent(typeKey)}`,
      input,
    ).then((r) => r.entry);
  }

  updateEntry(typeKey: string, id: string, input: EntryInput): Promise<Entry> {
    return this.request<{ entry: Entry }>(
      "PATCH",
      `/api/entries/${encodeURIComponent(typeKey)}/${encodeURIComponent(id)}`,
      input,
    ).then((r) => r.entry);
  }

  deleteEntry(typeKey: string, id: string): Promise<void> {
    return this.request<unknown>(
      "DELETE",
      `/api/entries/${encodeURIComponent(typeKey)}/${encodeURIComponent(id)}`,
    ).then(() => undefined);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.http(`${this.base}${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        // The same session a browser holds, on the header a terminal can set.
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const payload: unknown = await response.json().catch(() => undefined);

    if (!response.ok) throw problem(payload, response.status, `${method} ${path}`);

    return payload as T;
  }
}
