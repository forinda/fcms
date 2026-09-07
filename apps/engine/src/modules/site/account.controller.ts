/**
 * The visitor's own account, on the public site (ADR 0020).
 *
 * Flagged `site.public` like every other page here: these routes *are* the
 * public site, and the deny-by-default tree is the admin's. What makes that
 * safe is not a flag, it is that nothing reachable from here can write the
 * spec — a visitor session resolves to a `visitors` row and there is no code
 * path from one to a patch.
 */
import { Controller, Get, Inject, Post, getEnv, type Ctx } from "@forinda/kickjs";

import { PublicSite } from "@/route-flags";
import { VisitorCredentialsError, VisitorUseCase } from "@/shared/visitors/visitor.usecase";
import { readCookie } from "@/contributors/actor.contributor";

/** Distinct from `fcms_session` on purpose: a visitor must never look like an owner. */
export const VISITOR_COOKIE = "fcms_visitor";

@Controller()
@PublicSite
export class AccountController {
  @Inject(VisitorUseCase) private readonly visitors!: VisitorUseCase;

  @Post("/account/register")
  async register(ctx: Ctx): Promise<void> {
    const body = (ctx.body ?? {}) as Record<string, unknown>;

    try {
      const session = await this.visitors.register({
        email: String(body["email"] ?? ""),
        password: String(body["password"] ?? ""),
        name: String(body["name"] ?? ""),
      });
      this.setCookie(ctx, session.token, session.expiresAt);
      this.back(ctx, body);
    } catch (error) {
      this.back(ctx, body, message(error));
    }
  }

  @Post("/account/signin")
  async signIn(ctx: Ctx): Promise<void> {
    const body = (ctx.body ?? {}) as Record<string, unknown>;

    try {
      const session = await this.visitors.signIn({
        email: String(body["email"] ?? ""),
        password: String(body["password"] ?? ""),
      });
      this.setCookie(ctx, session.token, session.expiresAt);
      this.back(ctx, body);
    } catch (error) {
      this.back(ctx, body, message(error));
    }
  }

  @Post("/account/signout")
  async signOut(ctx: Ctx): Promise<void> {
    const token = this.token(ctx);
    if (token) await this.visitors.signOut(token);

    ctx.res.setHeader(
      "set-cookie",
      `${VISITOR_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
    this.back(ctx, (ctx.body ?? {}) as Record<string, unknown>);
  }

  /**
   * Keep or unkeep one entry.
   *
   * The id is not validated against the content type here — the repository
   * shape-checks it, and a save pointing at nothing renders as nothing. What
   * matters is that this cannot reach anything but the saves table.
   */
  @Post("/account/save")
  async save(ctx: Ctx): Promise<void> {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const visitor = await this.visitors.fromToken(this.token(ctx));
    if (!visitor) return this.back(ctx, body, "Sign in to keep this.");

    const entryId = String(body["entry"] ?? "");
    const typeKey = String(body["type"] ?? "");

    if (body["remove"] === "true") await this.visitors.unsave(visitor.id, entryId);
    else await this.visitors.save(visitor.id, typeKey, entryId);

    this.back(ctx, body);
  }

  /** What this visitor kept, as JSON — for a page that wants to mark its list. */
  @Get("/account/saved")
  async saved(ctx: Ctx): Promise<void> {
    const visitor = await this.visitors.fromToken(this.token(ctx));

    ctx.res.setHeader("content-type", "application/json; charset=utf-8");
    ctx.res.end(JSON.stringify({ saved: visitor ? await this.visitors.saved(visitor.id) : [] }));
  }

  private token(ctx: Ctx): string | undefined {
    const headers = ctx.req.headers as Record<string, string | string[] | undefined>;
    const raw = headers["cookie"];
    return readCookie(Array.isArray(raw) ? raw[0] : raw, VISITOR_COOKIE);
  }

  private setCookie(ctx: Ctx, token: string, expiresAt: Date): void {
    const parts = [
      `${VISITOR_COOKIE}=${encodeURIComponent(token)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Expires=${expiresAt.toUTCString()}`,
    ];
    if (getEnv("SECURE_COOKIES") === true) parts.push("Secure");
    ctx.res.setHeader("set-cookie", parts.join("; "));
  }

  /**
   * Back where they were, with the outcome in the URL.
   *
   * A visitor signs in *from* a page — a property they were looking at — and
   * losing that place is the difference between a sign-in and an interruption.
   * The destination is checked to be a path on this site: an open redirect on
   * a form that also sets a cookie is a phishing primitive.
   */
  private back(ctx: Ctx, body: Record<string, unknown>, error?: string): void {
    const asked = String(body["from"] ?? "/");
    const to = /^\/(?!\/)[^\s]*$/.test(asked) ? asked : "/";
    const query = error
      ? `${to.includes("?") ? "&" : "?"}account_error=${encodeURIComponent(error)}`
      : "";

    ctx.res.statusCode = 303;
    ctx.res.setHeader("location", `${to}${query}`);
    ctx.res.end();
  }
}

function message(error: unknown): string {
  if (error instanceof VisitorCredentialsError) return error.message;
  return error instanceof Error ? error.message : "That did not work.";
}
