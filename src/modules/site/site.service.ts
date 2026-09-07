/**
 * Loading and rendering a site.
 *
 * Thin: it resolves a scope into a `Site`, and turns a request path into a page
 * plus the rows behind it. Every decision it used to hold — how a redirect is
 * derived, what counts as destructive — now lives in a use-case in
 * `@forinda-cms/db`, next to the data it reads and testable without an HTTP
 * server. The redirect rule in particular was duplicated here, so its test had
 * to reimplement it to check it.
 */
import { Service, getEnv } from "@forinda/kickjs";
import { Site, createDb, type Db, type Scope } from "@forinda-cms/db";
import { renderPage, routes, type Entry } from "@forinda-cms/render";
import type { SiteSpec } from "@forinda-cms/spec";

export interface Rendered {
  readonly html: string;
  readonly title: string;
}

@Service()
export class SiteService {
  private readonly db: Db;

  constructor() {
    // `getEnv` rather than `@Value`: the parameter-decorator form does not
    // typecheck under TypeScript 7's decorator signatures. It is typed either
    // way — `kick typegen` derives `KickEnv` from the Zod schema in
    // `src/config`, so this is a `string` without anyone saying so.
    this.db = createDb(getEnv("DATABASE_URL"));
  }

  site(scope: Scope): Site {
    return new Site(this.db, scope);
  }

  spec(scope: Scope): Promise<SiteSpec | null> {
    return this.site(scope).spec();
  }

  redirects(scope: Scope): Promise<Map<string, string>> {
    return this.site(scope).redirects();
  }

  /**
   * The spec and its rows.
   *
   * Entries load for every declared type rather than only the ones a page
   * queries: a page renders each type it touches anyway, and one round trip
   * beats N awaited ones. It is a real ceiling — a site with a large collection
   * will want per-page loading, and `EntrySource` is where that change goes.
   */
  private async resolve(scope: Scope) {
    const site = this.site(scope);
    const spec = await site.spec();
    if (!spec) return null;
    const source = await site.entrySource(spec.content.map((t) => t.key));
    return { spec, source };
  }

  async render(scope: Scope, path: string, canonicalBase?: string): Promise<Rendered | null> {
    const resolved = await this.resolve(scope);
    if (!resolved) return null;

    const match = routes(resolved.spec, resolved.source).find((r) => r.path === path);
    if (!match) return null;

    return renderPage(
      match.page,
      { spec: resolved.spec, source: resolved.source, ...(canonicalBase ? { canonicalBase } : {}) },
      match.entry as Entry | undefined,
    );
  }

  /** Public, indexable routes. Drafts and noindex pages are excluded (doc 08). */
  async publicRoutes(scope: Scope): Promise<string[]> {
    const resolved = await this.resolve(scope);
    if (!resolved) return [];
    return routes(resolved.spec, resolved.source)
      .filter((r) => !r.page.draft && r.page.seo?.noindex !== true)
      .map((r) => r.path);
  }
}
