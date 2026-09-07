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

export interface ClientOptions {
  readonly url: string;
  readonly token?: string | undefined;
  /** Injectable so tests do not need a listening socket. */
  readonly fetch?: typeof globalThis.fetch;
}

export class Client {
  private readonly base: string;
  private readonly token: string | undefined;
  private readonly http: typeof globalThis.fetch;

  constructor(options: ClientOptions) {
    // One trailing slash difference otherwise becomes `//api/status`, which
    // some proxies answer and some redirect.
    this.base = options.url.replace(/\/+$/, "");
    this.token = options.token;
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
    });
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

    if (!response.ok) {
      const detail = payload as
        | { message?: unknown; error?: unknown; issues?: { path: string; message: string }[] }
        | undefined;
      const message =
        typeof detail?.message === "string"
          ? detail.message
          : typeof detail?.error === "string"
            ? detail.error
            : `${method} ${path} failed with ${response.status}`;
      throw new ApiError(response.status, message, detail?.issues ?? []);
    }

    return payload as T;
  }
}
