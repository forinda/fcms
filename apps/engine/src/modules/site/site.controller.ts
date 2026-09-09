/**
 * The public site.
 *
 * Every route here is deliberately flagged `site.public` at the class level
 * rather than per method — ADR 0008 §4 splits the flag by *surface*, so there is
 * one public tree and one deny-by-default tree, and no route becomes public
 * because someone forgot.
 */
import { Autowired, Controller, Get, Inject, type Ctx, type RequestContext } from "@forinda/kickjs";

import { PublicSite } from "@/route-flags";
import { readCookie, SESSION_COOKIE } from "@/contributors/actor.contributor";
import { AuthenticateUseCase } from "@/shared/auth/auth.usecase";
import { VisitorUseCase } from "@/shared/visitors/visitor.usecase";
import { VISITOR_COOKIE } from "./account.controller";
import { FLOW_COOKIE } from "@/shared/flows/flow.usecase";
import { MediaUseCase } from "@/modules/admin/use-cases/media.usecase";
import { SiteService } from "./site.service";

@Controller()
@PublicSite
export class SiteController {
  // Property injection, matching the generated shape. Constructor injection
  // does not resolve here, and it fails by leaving the controller
  // uninstantiable — which surfaces as routes that simply never mount.
  @Autowired() private readonly sites!: SiteService;

  /**
   * Only used to decide whether this request may see a draft.
   *
   * The site is public, so there is no actor on `ctx` here (ADR 0008 §4). A
   * preview is the one case where the public tree needs to know who is asking,
   * and it asks rather than trusting a query parameter — otherwise `?edit=1`
   * would publish every draft to anyone who typed it.
   */
  @Inject(AuthenticateUseCase) private readonly authenticate!: AuthenticateUseCase;

  /** Reads uploaded files; see `media` below. */
  @Inject(MediaUseCase) private readonly assets!: MediaUseCase;

  /** Resolves the visitor whose rows a `mine` query may return. */
  @Inject(VisitorUseCase) private readonly visitors!: VisitorUseCase;

  /** The journey token, so a flow renders the step this visitor is on. */
  private flowToken(ctx: Ctx): string | undefined {
    const headers = ctx.req.headers as Record<string, string | string[] | undefined>;
    const raw = headers["cookie"];
    return readCookie(Array.isArray(raw) ? raw[0] : raw, FLOW_COOKIE);
  }

  /** The visitor's session token, if they have one. */
  private visitorToken(ctx: Ctx): string | undefined {
    const headers = ctx.req.headers as Record<string, string | string[] | undefined>;
    const raw = headers["cookie"];
    return readCookie(Array.isArray(raw) ? raw[0] : raw, VISITOR_COOKIE);
  }

  /** Is this the canvas, run by someone signed in? */
  private async mayPreview(ctx: Ctx): Promise<boolean> {
    const url = ctx.req.url ?? "";
    if (!url.includes("edit=1")) return false;

    const headers = ctx.req.headers as Record<string, string | string[] | undefined>;
    const raw = headers["cookie"];
    const cookie = Array.isArray(raw) ? raw[0] : raw;
    return (await this.authenticate.execute(readCookie(cookie, SESSION_COOKIE))) !== null;
  }

  /** Absolute base for canonicals and the sitemap (doc 08). */
  private base(ctx: RequestContext): string | undefined {
    const configured = process.env["PUBLIC_URL"];
    if (configured) return configured.replace(/\/$/, "");
    const host = ctx.require("site")?.host;
    return host ? `https://${host}` : undefined;
  }

  /**
   * One uploaded file.
   *
   * Public, because a picture on a page is public by definition — the
   * unguessable id is not a security boundary and is not treated as one.
   *
   * Cached immutably: the bytes are content-addressed, so an id always answers
   * the same file. Changing a picture means uploading another, which is a
   * different id.
   */
  @Get("/media/:id")
  async asset(ctx: Ctx): Promise<void> {
    const asset = await this.assets.byId(String((ctx.params as Record<string, string>)["id"]));
    const bytes = asset ? await this.assets.read(asset.blobHash).catch(() => null) : null;

    if (!asset || !bytes) {
      ctx.res.statusCode = 404;
      ctx.res.end();
      return;
    }

    ctx.res.setHeader("content-type", asset.contentType);
    ctx.res.setHeader("cache-control", "public, max-age=31536000, immutable");
    // `nosniff` and an explicit disposition: only images and PDFs can be stored
    // (the upload allowlist), and neither should ever be sniffed into something
    // the browser will run from this origin.
    ctx.res.setHeader("x-content-type-options", "nosniff");
    ctx.res.setHeader(
      "content-disposition",
      `inline; filename="${asset.filename.replace(/["\\]/g, "")}"`,
    );
    ctx.res.end(bytes);
  }

  /**
   * `robots.txt`.
   *
   * Points at the sitemap and nothing else. A CMS that writes `Disallow:` rules
   * an owner did not ask for is a CMS that quietly deindexes someone's business.
   */
  @Get("/robots.txt")
  async robots(ctx: Ctx): Promise<void> {
    const base = this.base(ctx);
    ctx.res.setHeader("content-type", "text/plain; charset=utf-8");
    ctx.res.end(
      ["User-agent: *", "Allow: /", ...(base ? [`Sitemap: ${base}/sitemap.xml`] : [])].join("\n") +
        "\n",
    );
  }

  /** `sitemap.xml`, generated from the spec and updated by construction (doc 08). */
  @Get("/sitemap.xml")
  async sitemap(ctx: Ctx): Promise<void> {
    const base = this.base(ctx) ?? "";
    const paths = await this.sites.publicRoutes();

    const urls = paths.map((p) => `  <url><loc>${escapeXml(`${base}${p}`)}</loc></url>`).join("\n");

    ctx.res.setHeader("content-type", "application/xml; charset=utf-8");
    ctx.res.end(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    );
  }

  /**
   * Everything else — the rendered site.
   *
   * A miss checks the redirect table before answering 404, so a page that moved
   * keeps its search traffic without anyone writing a rule (doc 08).
   */
  /**
   * The root, separately from the catch-all.
   *
   * Express 5's `/*path` requires at least one segment, so it does not match
   * `/` — the homepage, and the single most-requested URL on any site. Both
   * routes share one handler rather than duplicating it.
   */
  @Get("/")
  async home(ctx: Ctx): Promise<void> {
    return this.page(ctx);
  }

  @Get("/*path")
  async page(ctx: Ctx): Promise<void> {
    const url = (ctx.req.url ?? "/").split("?")[0] ?? "/";
    const path = url !== "/" && url.endsWith("/") ? url.slice(0, -1) : url;

    // The query string is what a visitor's filters, sort and page arrive in
    // (ADR 0019). Passed as-is; the query resolver decides what any of it means,
    // and ignores anything that does not name a filterable field.
    const rendered = await this.sites.render(
      path,
      this.base(ctx),
      await this.mayPreview(ctx),
      ctx.query as Record<string, string | string[] | undefined>,
      // Who is signed in, read from the cookie rather than the query string —
      // a `mine` query is answered from this and nothing else (ADR 0027 §2).
      (await this.visitors.fromToken(this.visitorToken(ctx)))?.id ?? null,
      this.flowToken(ctx),
    );
    if (rendered) {
      ctx.res.setHeader("content-type", "text/html; charset=utf-8");
      // The framework sends `X-Frame-Options: DENY` on everything, which is
      // right for the admin and wrong here: the canvas edits the page by
      // framing it (ADR 0017 §2), and DENY made that pane a broken-image icon.
      // `SAMEORIGIN` keeps the site out of *other* people's frames, which is
      // what the header is for.
      ctx.res.setHeader("x-frame-options", "SAMEORIGIN");
      ctx.res.end(rendered.html);
      return;
    }

    const target = (await this.sites.redirects()).get(path);
    if (target) {
      // 301, not 302: the move is permanent, and a temporary redirect tells a
      // search engine to keep the old URL — which is the outcome this exists to
      // prevent.
      ctx.res.statusCode = 301;
      ctx.res.setHeader("location", target);
      ctx.res.end();
      return;
    }

    ctx.res.statusCode = 404;
    ctx.res.setHeader("content-type", "text/html; charset=utf-8");
    // The site's own 404 — its layout, its colours, a sentence somebody outside
    // this project would write, and a way back. The bare `<h1>Not found</h1>`
    // that was here reads as a broken site rather than a wrong address.
    const page = await this.sites.renderStatus(404, this.base(ctx));
    ctx.res.end(
      page?.html ?? "<!doctype html><meta charset=utf-8><title>Not found</title><h1>Not found</h1>",
    );
  }
}

function escapeXml(value: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  };
  return value.replace(/[&<>"']/g, (c) => map[c]!);
}
