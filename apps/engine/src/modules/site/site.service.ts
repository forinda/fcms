/**
 * Turning a request path into rendered HTML.
 *
 * Thin: it owns the one thing neither the repository nor the renderer can — a
 * path resolved to a page plus the rows behind it, in a single pass. Every
 * decision it used to hold lives in a use-case now, next to the data it reads
 * and testable without an HTTP server.
 *
 * It also no longer resolves the site. The use-cases it injects are
 * request-scoped and take the scope from `CURRENT_SCOPE`, so this asks for
 * "the spec for this request" rather than threading a scope through every
 * method — which is what makes the multi-site switch a change to one factory
 * instead of to every caller.
 */
import { Inject, Service } from "@forinda/kickjs";
import { renderPage, routes, type Entry } from "@forinda-cms/render";
import type { SiteSpec } from "@forinda-cms/spec";

import { EntryReadUseCase, SiteSpecUseCase } from "@/shared/use-cases";
import { RedirectsUseCase } from "./use-cases/redirects.usecase";

export interface Rendered {
  readonly html: string;
  readonly title: string;
}

@Service()
export class SiteService {
  @Inject(SiteSpecUseCase) private readonly specs!: SiteSpecUseCase;
  @Inject(EntryReadUseCase) private readonly entries!: EntryReadUseCase;
  @Inject(RedirectsUseCase) private readonly moved!: RedirectsUseCase;

  spec(): Promise<SiteSpec | null> {
    return this.specs.execute();
  }

  redirects(): Promise<Map<string, string>> {
    return this.moved.execute();
  }

  /**
   * The spec and its rows.
   *
   * Entries load for every declared type rather than only the ones a page
   * queries: a page renders each type it touches anyway, and one round trip
   * beats N awaited ones. It is a real ceiling — a site with a large collection
   * will want per-page loading, and `EntrySource` is where that change goes.
   */
  private async resolve() {
    const spec = await this.specs.execute();
    if (!spec) return null;
    const source = await this.entries.source(spec.content.map((t) => t.key));
    return { spec, source };
  }

  /**
   * @param preview Include draft pages. Only ever true for a signed-in owner
   *   looking at the canvas — a draft is unpublished, not merely unlinked.
   */
  async render(path: string, canonicalBase?: string, preview = false): Promise<Rendered | null> {
    const resolved = await this.resolve();
    if (!resolved) return null;

    const match = routes(resolved.spec, resolved.source, { drafts: preview }).find(
      (r) => r.path === path,
    );
    if (!match) return null;

    return renderPage(
      match.page,
      { spec: resolved.spec, source: resolved.source, ...(canonicalBase ? { canonicalBase } : {}) },
      match.entry as Entry | undefined,
    );
  }

  /** Public, indexable routes. Drafts and noindex pages are excluded (doc 08). */
  async publicRoutes(): Promise<string[]> {
    const resolved = await this.resolve();
    if (!resolved) return [];
    return routes(resolved.spec, resolved.source)
      .filter((r) => !r.page.draft && r.page.seo?.noindex !== true)
      .map((r) => r.path);
  }
}
