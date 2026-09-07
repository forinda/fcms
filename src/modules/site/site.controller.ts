/**
 * The public site.
 *
 * Every route here is deliberately flagged `site.public` at the class level
 * rather than per method — ADR 0008 §4 splits the flag by *surface*, so there is
 * one public tree and one deny-by-default tree, and no route becomes public
 * because someone forgot.
 */
import { Autowired, Controller, Get, type Ctx, type RequestContext } from "@forinda/kickjs";

import { PublicSite } from "@/route-flags";
import { SiteService } from "./site.service";

@Controller()
@PublicSite
export class SiteController {
  // Property injection, matching the generated shape. Constructor injection
  // does not resolve here, and it fails by leaving the controller
  // uninstantiable — which surfaces as routes that simply never mount.
  @Autowired() private readonly sites!: SiteService;

  /** Absolute base for canonicals and the sitemap (doc 08). */
  private base(ctx: RequestContext): string | undefined {
    const configured = process.env["PUBLIC_URL"];
    if (configured) return configured.replace(/\/$/, "");
    const host = ctx.require("site")?.host;
    return host ? `https://${host}` : undefined;
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
    const site = ctx.require("site");
    const base = this.base(ctx) ?? "";
    const paths = site ? await this.sites.publicRoutes(site) : [];

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
    const site = ctx.require("site");
    if (!site) {
      ctx.res.statusCode = 404;
      ctx.res.end("No site configured.");
      return;
    }

    const url = (ctx.req.url ?? "/").split("?")[0] ?? "/";
    const path = url !== "/" && url.endsWith("/") ? url.slice(0, -1) : url;

    const rendered = await this.sites.render(site, path, this.base(ctx));
    if (rendered) {
      ctx.res.setHeader("content-type", "text/html; charset=utf-8");
      ctx.res.end(rendered.html);
      return;
    }

    const target = (await this.sites.redirects(site)).get(path);
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
    ctx.res.end("<!doctype html><meta charset=utf-8><title>Not found</title><h1>Not found</h1>");
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
