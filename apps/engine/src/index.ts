import "reflect-metadata";
// Side-effect import, and it must come first: it registers the env schema
// before any `@Value` or `ConfigService.get` resolves. Without it those return
// undefined and Zod's coercion and defaults are silently skipped.
import "./config";
import { bootstrap, createLogger, errorHandler, expressRuntime } from "@forinda/kickjs";
import { statusHtml } from "@forinda-cms/render";

import { adapters } from "./adapters";
import { modules } from "./modules";

const log = createLogger("Site");

/**
 * The framework's own handler, for everything that is not a browser.
 *
 * Passing the error to `next` instead reaches **Express's** default handler,
 * not this one, and that one answers an HTML stack trace — so delegating from
 * here would have replaced RFC 9457 problem details with a leak.
 */
const problem = errorHandler();

/** A browser asking for a page, rather than a client asking for JSON. */
function wantsHtml(req: { url?: string; headers?: Record<string, unknown> }): boolean {
  const path = String(req.url ?? "");
  // The admin and the API have their own error formats, and a visitor never
  // sees either — a 500 there should stay a problem document.
  if (path.startsWith("/admin") || path.startsWith("/api") || path.startsWith("/flow/")) {
    return false;
  }
  const accept = req.headers?.["accept"];
  return String(Array.isArray(accept) ? accept[0] : (accept ?? "")).includes("text/html");
}

/**
 * A website, not an API.
 *
 * KickJS defaults to mounting routes at `/{apiPrefix}/v{version}/{path}` —
 * sensible for the API it is usually used to build, and wrong here: a public
 * site cannot live under `/api/v1`, and neither can `robots.txt` or
 * `sitemap.xml`, which crawlers only ever look for at the root.
 *
 * So both are switched off. A future admin or MCP surface can opt *into*
 * versioning per module, which is the right way round — the thing with an
 * external contract versions itself, the public pages do not.
 */
export const app = await bootstrap({
  modules,
  adapters,
  runtime: expressRuntime(),
  apiPrefix: "",
  defaultVersion: false,
  /**
   * What a visitor sees when the server breaks.
   *
   * The default handler answers a problem document — correct for an API and
   * unreadable in a browser, where somebody who was trying to book a room gets
   * a wall of JSON and concludes the business is not real. The wording is the
   * same one the 404 uses, and the page depends on nothing: a 500 is often the
   * database being unreachable, and the spec lives in the database.
   *
   * `next` is a no-op on runtimes other than Express, so this answers rather
   * than delegating.
   */
  onError: (err, req, res, _next) => {
    log.error(err instanceof Error ? err : new Error(String(err)), `${req?.method} ${req?.url}`);

    if (!wantsHtml(req ?? {})) {
      problem(err, req, res, () => {});
      return;
    }

    const status = Number(err?.status ?? err?.statusCode ?? 500);
    res.writeHead(status >= 400 && status < 600 ? status : 500, {
      "content-type": "text/html; charset=utf-8",
    });
    res.end(statusHtml(status >= 400 && status < 600 ? status : 500, process.env["SITE_NAME"]));
  },
});
