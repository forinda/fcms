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
import {
  declaredStatusPage,
  renderPage,
  routes,
  statusPage,
  type Entry,
} from "@forinda-cms/render";
import type { SiteSpec } from "@forinda-cms/spec";

import { BLOCKS } from "@/plugins";
import { EntryReadUseCase, SiteSpecUseCase } from "@/shared/use-cases";
import { FlowUseCase } from "@/shared/flows/flow.usecase";
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
  @Inject(FlowUseCase) private readonly flows!: FlowUseCase;

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
  private async resolve(viewer?: string | null) {
    const spec = await this.specs.execute();
    if (!spec) return null;
    // The viewer reaches the source, not just the renderer: their own drafts
    // have to be *read* before a `mine` query can show them (ADR 0027 §3).
    // A derived type's `occupied` rows are read for occupancy, so they are
    // loaded whatever their status: a booking that is waiting to be approved
    // still holds the room.
    const held = spec.content.flatMap((t) => (t.derived ? [t.derived.occupied.type] : []));
    const source = await this.entries.source(
      spec.content.map((t) => t.key),
      viewer,
      held,
    );
    return { spec, source };
  }

  /**
   * @param preview Include draft pages. Only ever true for a signed-in owner
   *   looking at the canvas — a draft is unpublished, not merely unlinked.
   */
  async render(
    path: string,
    canonicalBase?: string,
    preview = false,
    params: Readonly<Record<string, string | readonly string[] | undefined>> = {},
    /** The signed-in visitor, from the session cookie. Never from a parameter. */
    viewer?: string | null,
    /** The journey token, so a flow renders the step this visitor is on. */
    flowToken?: string | undefined,
  ): Promise<Rendered | null> {
    const resolved = await this.resolve(viewer);
    if (!resolved) return null;

    const match = routes(resolved.spec, resolved.source, { drafts: preview }).find(
      (r) => r.path === path,
    );
    if (!match) return null;

    // What this visitor has chosen so far, per flow on this page (ADR 0028).
    // Read here rather than in the renderer, which has no database.
    const flow: Record<string, Record<string, unknown>> = {};
    for (const declared of match.page.flows ?? []) {
      Object.assign(flow, await this.flows.answers(flowToken, match.page.key, declared.key));
    }

    return renderPage(
      match.page,
      {
        spec: resolved.spec,
        source: resolved.source,
        registry: BLOCKS,
        // What the site says its money and dates look like. Without this the
        // renderer fell back to its own default and every site on earth priced
        // itself in Kenyan shillings.
        locale: { locale: resolved.spec.locale, currency: resolved.spec.currency },
        params,
        ...(viewer ? { viewer } : {}),
        ...(Object.keys(flow).length > 0 ? { flow } : {}),
        path,
        ...(canonicalBase ? { canonicalBase } : {}),
      },
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
  /**
   * The page a visitor gets when there is no page.
   *
   * A site answered 404 with `<h1>Not found</h1>` — no header, no footer, no
   * colours, nothing to do next. That is a developer's 404 shown to somebody
   * who mistyped an address, and it reads as "this site is broken" rather than
   * "that address is wrong".
   *
   * An author who writes a page at `/404` gets theirs; everybody else gets one
   * in their own site's clothes without asking for it. `null` only when the
   * site has no spec at all, which is a genuinely different situation.
   */
  async renderStatus(status: number, canonicalBase?: string): Promise<Rendered | null> {
    const resolved = await this.resolve(null);
    if (!resolved) return null;

    const page = declaredStatusPage(resolved.spec, status) ?? statusPage(resolved.spec, status);
    return renderPage(page, {
      spec: resolved.spec,
      source: resolved.source,
      registry: BLOCKS,
      locale: { locale: resolved.spec.locale, currency: resolved.spec.currency },
      path: `/${status}`,
      ...(canonicalBase ? { canonicalBase } : {}),
    });
  }
}
