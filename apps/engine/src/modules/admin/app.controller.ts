/**
 * Serving the admin application (ADR 0044).
 *
 * `/app` is the React build; `/admin` is the server-rendered admin it is
 * replacing screen by screen. Both are the same product on the same session, so
 * this is a static file server and nothing more — the application talks to
 * `/api`, which is the point of moving it.
 *
 * Every unknown path under `/app` answers with `index.html`, because a client
 * router owns those addresses. That is also why this cannot be a blanket static
 * mount: a 404 for `/app/content/booking` would break the back button.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

import { Controller, Get, type Ctx } from "@forinda/kickjs";

import { readCookie, SESSION_COOKIE } from "@/contributors/actor.contributor";
import { PublicAuth } from "@/route-flags";
import { firstHeader } from "./utils/http";

/**
 * Where the build lands.
 *
 * Looked for rather than assumed, because the engine runs from three different
 * shapes: this file inside the source tree under `pnpm dev`, a bundle at
 * `/app/dist/index.js` in the image, and a test from the package root. One
 * hard-coded relative path is right in exactly one of them — and the failure is
 * a blank screen, which reads as a broken app rather than a missing build.
 *
 * Resolved on each request rather than at import, so a build that finishes
 * after the server started is served without a restart.
 */
function distDir(): string | null {
  const candidates = [
    process.env["ADMIN_DIST"],
    // The source tree: apps/engine/src/modules/admin → apps/admin/dist/client.
    // `client` because React Router's build emits the browser half there
    // (ADR 0044); the server half is deleted by `ssr: false`.
    resolve(import.meta.dirname, "../../../../admin/dist/client"),
    // The image: /app/dist → /app/apps/admin/dist/client.
    resolve(import.meta.dirname, "../apps/admin/dist/client"),
    resolve(process.cwd(), "apps/admin/dist/client"),
    resolve(process.cwd(), "../admin/dist/client"),
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(join(candidate, "index.html"))) return candidate;
  }
  return null;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

@Controller()
export class AppController {
  @Get("/app")
  @PublicAuth
  async root(ctx: Ctx): Promise<void> {
    if (this.signedOut(ctx)) return;
    this.serve(ctx, "index.html");
  }

  @Get("/app/*path")
  @PublicAuth
  async asset(ctx: Ctx): Promise<void> {
    if (this.signedOut(ctx)) return;

    // Read from the URL rather than from a route parameter, the way the site's
    // own catch-all does: the wildcard's name is a framework detail, and this
    // has to be exactly the bytes after `/app/` for a file lookup to be right.
    const url = (ctx.req.url ?? "/app/").split("?")[0] ?? "";
    this.serve(ctx, decodeURIComponent(url.replace(/^\/app\/?/, "")));
  }

  /**
   * Somebody arriving with no session at all goes to the sign-in page.
   *
   * The routes are public because what they serve is a build artifact holding
   * no data — but answering a browser with a 401 JSON body is a worse door than
   * a redirect. A *stale* cookie still gets the shell, and the first `/api`
   * call sends them on; this only catches the cold arrival.
   */
  private signedOut(ctx: Ctx): boolean {
    const headers = ctx.req.headers as Record<string, string | string[] | undefined>;
    if (readCookie(firstHeader(headers["cookie"]) ?? undefined, SESSION_COOKIE)) return false;

    ctx.res.statusCode = 303;
    ctx.res.setHeader("location", "/admin/login");
    ctx.res.end();
    return true;
  }

  private serve(ctx: Ctx, asked: string): void {
    const dist = distDir();
    if (!dist) {
      ctx.res.statusCode = 503;
      ctx.res.setHeader("content-type", "text/plain; charset=utf-8");
      ctx.res.end(
        "The admin application has not been built. Run `pnpm --filter @forinda-cms/admin build`.\n",
      );
      return;
    }

    // Normalised and then confined: `..` in a URL is how a static server hands
    // out the private key next to it.
    const candidate = resolve(dist, normalize(asked).replace(/^([/\\.]+)/, ""));
    const inside = candidate.startsWith(`${dist}/`) || candidate === dist;
    const file =
      inside && existsSync(candidate) && statSync(candidate).isFile()
        ? candidate
        : join(dist, "index.html");

    const body = readFileSync(file);
    ctx.res.statusCode = 200;
    ctx.res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
    ctx.res.setHeader("x-robots-tag", "noindex, nofollow");
    ctx.res.setHeader("x-content-type-options", "nosniff");
    // Hashed filenames may be cached forever; the entry point never can, or an
    // upgrade is invisible until somebody clears their browser.
    ctx.res.setHeader(
      "cache-control",
      file.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
    );
    ctx.res.end(body);
  }
}
