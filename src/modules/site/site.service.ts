/**
 * Loading and rendering a site.
 *
 * Sits between the repository and the renderer, and owns the one thing neither
 * of them can: turning a request path into a page plus the rows it needs, in a
 * single pass.
 */
import { Service, getEnv } from "@forinda/kickjs";
import { SiteRepository, createDb, loadEntrySource, type Db } from "@forinda-cms/db";
import { renderPage, routes, type Entry } from "@forinda-cms/render";
import type { SiteSpec } from "@forinda-cms/spec";

export interface Rendered {
  readonly html: string;
  readonly title: string;
}

export interface SiteScopeInput {
  readonly orgId: string;
  readonly siteId: string;
}

@Service()
export class SiteService {
  private readonly db: Db;

  constructor() {
    // `getEnv` rather than `@Value`: the parameter-decorator form does not
    // type-check under TypeScript 7's decorator signatures, and reading the
    // value here is the same thing with one less mechanism.
    this.db = createDb(getEnv("DATABASE_URL") as string);
  }

  repository(scope: SiteScopeInput): SiteRepository {
    return new SiteRepository(this.db, scope);
  }

  async spec(scope: SiteScopeInput): Promise<SiteSpec | undefined> {
    return this.repository(scope).loadSpec();
  }

  /**
   * Every route the spec answers, with the rows behind it.
   *
   * Entries are loaded for every declared type rather than only the ones this
   * page queries. A page renders each type it touches anyway, and one round
   * trip for the site's content beats N awaited ones — but it is a real
   * ceiling: a site with a large collection will want per-page loading, and the
   * `EntrySource` interface is where that change goes.
   */
  private async resolve(scope: SiteScopeInput) {
    const repo = this.repository(scope);
    const spec = await repo.loadSpec();
    if (!spec) return undefined;
    const source = await loadEntrySource(
      repo,
      spec.content.map((t) => t.key),
    );
    return { spec, source };
  }

  async render(
    scope: SiteScopeInput,
    path: string,
    canonicalBase?: string,
  ): Promise<Rendered | undefined> {
    const resolved = await this.resolve(scope);
    if (!resolved) return undefined;

    const match = routes(resolved.spec, resolved.source).find((r) => r.path === path);
    if (!match) return undefined;

    return renderPage(
      match.page,
      {
        spec: resolved.spec,
        source: resolved.source,
        ...(canonicalBase ? { canonicalBase } : {}),
      },
      match.entry as Entry | undefined,
    );
  }

  /** Public, indexable routes. Drafts and previews are excluded (doc 08). */
  async publicRoutes(scope: SiteScopeInput): Promise<string[]> {
    const resolved = await this.resolve(scope);
    if (!resolved) return [];
    return routes(resolved.spec, resolved.source)
      .filter((r) => !r.page.draft && r.page.seo?.noindex !== true)
      .map((r) => r.path);
  }

  /**
   * Redirects derived from the patch history.
   *
   * Doc 08 calls this the highest-value item on the SEO list, and ADR 0002 put
   * it in Phase 0b for a specific reason: *"the automatic 301 only works because
   * the patch inverse already recorded the old path."* This is that claim cashed
   * in — the old path is read out of the inverse of a patch that moved a page,
   * so nobody has to remember to write a redirect.
   *
   * DIY builders lose people's search rankings here routinely, and it is the
   * single most common regret of anyone who migrates.
   */
  async redirects(scope: SiteScopeInput): Promise<Map<string, string>> {
    const repo = this.repository(scope);
    const spec = await repo.loadSpec();
    if (!spec) return new Map();

    const live = new Set(spec.pages.map((p) => p.path));
    const byKey = new Map(spec.pages.map((p) => [p.key, p.path]));
    const out = new Map<string, string>();

    for (const patch of await repo.rawHistory(200)) {
      const previous = (patch.inverse as { value?: unknown }[])[0]?.value as
        | SiteSpec
        | null
        | undefined;
      if (!previous?.pages) continue;
      for (const page of previous.pages) {
        const now = byKey.get(page.key);
        // Only when the page still exists somewhere else. A page that was
        // deleted outright has nowhere to send anyone, and a redirect to the
        // homepage is worse than a 404 — it tells a search engine the content
        // moved when it did not.
        if (!now || now === page.path || live.has(page.path)) continue;
        if (!out.has(page.path)) out.set(page.path, now);
      }
    }
    return out;
  }
}
