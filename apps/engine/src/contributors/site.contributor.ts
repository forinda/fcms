/**
 * Which site this request is for.
 *
 * Doc 03 §4's `LoadSite`, with the tenancy taken out: v1 is single-site, so the
 * site comes from configuration rather than from the host. The *shape* is the multi-site one — resolve once
 * per request, publish on `ctx`, read with `ctx.require` — so switching the
 * resolver to a host lookup later changes this file and nothing downstream.
 *
 * Two details are deliberate:
 *
 *   - `resolve` **returns** the value; the runner writes it with `ctx.set`.
 *     Assigning a property would stick to this contributor's own instance and
 *     the handler would never see it.
 *   - Resolving to `null` rather than throwing, so a route that genuinely has no
 *     site (health) is not forced to invent one. A route that needs a site says
 *     so by calling `ctx.require`.
 */
import {
  ctn,
  defineHttpContextDecorator,
  getEnv,
  getRequestValue,
  requestStore,
} from "@forinda/kickjs";
import type { Scope } from "@forinda-cms/db";

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

/**
 * The scope this request is for — `{ orgId, siteId }`, and nothing else.
 *
 * Declared beside the contributor that resolves it, so the token and the value
 * it depends on move together. It used to bind a `Site` facade holding every
 * operation; the operations are now request-scoped use-cases that inject this,
 * which is what lets each one be resolved, substituted and tested on its own.
 *
 * **Request-scoped**: a singleton would be a site chosen at boot, which is the
 * shape multi-site has to break anyway (doc 03 §4).
 */
export const CURRENT_SCOPE = ctn<Scope>("app/Site/scope");

/**
 * `CURRENT_SCOPE`'s factory: the site this unit of work is for.
 *
 * `getRequestValue` rather than a `ctx` reference: a factory has no request
 * object, and `ResolveSite` (or `inSite`) already published the scope under
 * `site` (doc 03 §4).
 */
export function currentScope(): Scope {
  const scope = getRequestValue("site");
  if (!scope) throw new Error("no site on this request — is ResolveSite applied?");
  return scope;
}

/**
 * Run `work` for one site, outside an HTTP request: boot, the workflow tick, a
 * script.
 *
 * It opens the same unit of work a request does, with `site` set as
 * `ResolveSite` would set it — so `CURRENT_SCOPE` and every request-scoped
 * use-case resolve from the container exactly as they do in a request, rather
 * than being assembled by hand with `new` and drifting from what the container
 * builds. A child container with `CURRENT_SCOPE` overridden looks like the
 * answer and is not: a class the parent registers is built with the parent's
 * bindings, so the override never reaches it.
 */
export function inSite<T>(scope: Scope, work: () => Promise<T>): Promise<T> {
  return requestStore.run(
    {
      requestId: `site:${scope.siteId}`,
      instances: new Map(),
      values: new Map([["site", { ...scope, host: null }]]),
    },
    work,
  );
}

export const ResolveSite = defineHttpContextDecorator({
  key: "site",
  async resolve(ctx): Promise<SiteScope | null> {
    const headers = ctx.req.headers as Record<string, string | string[] | undefined>;
    return {
      orgId: getEnv("ORG_ID"),
      siteId: getEnv("SITE_ID"),
      // Read through `getEnv` rather than a captured constant so an env reload
      // flips proxy trust without a restart.
      host: pickHost(headers, getEnv("TRUST_PROXY") === true),
    };
  },
});
