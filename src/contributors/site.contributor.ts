/**
 * Which site this request is for.
 *
 * Doc 03 §4's `LoadSite`, and `enaton`'s `tenant-route` contributor with the
 * tenancy taken out: v1 is single-site, so the site comes from configuration
 * rather than from the host. The *shape* is the multi-site one — resolve once
 * per request, publish on `ctx`, read with `ctx.require` — so switching the
 * resolver to a host lookup later changes this file and nothing downstream.
 *
 * Two details carried over from `enaton` deliberately:
 *
 *   - `resolve` **returns** the value; the runner writes it with `ctx.set`.
 *     Assigning a property would stick to this contributor's own instance and
 *     the handler would never see it.
 *   - Resolving to `null` rather than throwing, so a route that genuinely has no
 *     site (health) is not forced to invent one. A route that needs a site says
 *     so by calling `ctx.require`.
 */
import { defineHttpContextDecorator, getEnv } from "@forinda/kickjs";

export interface SiteScope {
  readonly orgId: string;
  readonly siteId: string;
  /** The host this request arrived on, for canonicals and the sitemap. */
  readonly host: string | null;
}

declare module "@forinda/kickjs" {
  interface ContextMeta {
    /** The site this request routes to, or `null` where none applies. */
    site: SiteScope | null;
  }
}

function pickHost(
  headers: Record<string, string | string[] | undefined>,
  trustProxy: boolean,
): string | null {
  const forwarded = trustProxy ? headers["x-forwarded-host"] : undefined;
  const raw = forwarded ?? headers["host"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ?? null;
}

export const ResolveSite = defineHttpContextDecorator({
  key: "site",
  async resolve(ctx): Promise<SiteScope | null> {
    const headers = ctx.req.headers as Record<string, string | string[] | undefined>;
    return {
      orgId: getEnv("ORG_ID") as string,
      siteId: getEnv("SITE_ID") as string,
      // Read through `getEnv` rather than a captured constant so an env reload
      // flips proxy trust without a restart.
      host: pickHost(headers, getEnv("TRUST_PROXY") === true),
    };
  },
});
