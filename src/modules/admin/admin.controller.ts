/**
 * Signing in and out.
 *
 * The deny-by-default surface: nothing in this module is reachable without a
 * session except the two routes flagged `auth.public`, which are the login form
 * and its POST (ADR 0008 §4).
 */
import { Controller, Get, Inject, Post, getEnv, type Ctx } from "@forinda/kickjs";
import { InvalidCredentialsError, type LoginUseCase, type LogoutUseCase } from "@forinda-cms/db";

import { LOGIN, LOGOUT } from "@/adapters/database.adapter";

import { readCookie, SESSION_COOKIE } from "@/contributors/actor.contributor";
import { PublicAuth } from "@/route-flags";

@Controller()
export class AdminController {
  @Inject(LOGIN) private readonly loginUseCase!: LoginUseCase;
  @Inject(LOGOUT) private readonly logoutUseCase!: LogoutUseCase;

  @Get("/login")
  @PublicAuth
  async loginForm(ctx: Ctx): Promise<void> {
    html(ctx, 200, page("Sign in", loginForm()));
  }

  @Post("/login")
  @PublicAuth
  async login(ctx: Ctx): Promise<void> {
    const body = (ctx.body ?? {}) as { email?: string; password?: string };
    const headers = ctx.req.headers as Record<string, string | string[] | undefined>;

    try {
      const session = await this.loginUseCase.execute({
        email: String(body.email ?? ""),
        password: String(body.password ?? ""),
        userAgent: firstHeader(headers["user-agent"]),
        ipAddress: firstHeader(headers["x-forwarded-for"]) ?? ctx.req.socket?.remoteAddress ?? null,
      });

      ctx.res.setHeader("set-cookie", sessionCookie(session.token, session.expiresAt));
      ctx.res.statusCode = 303;
      ctx.res.setHeader("location", "/admin");
      ctx.res.end();
    } catch (error) {
      if (!(error instanceof InvalidCredentialsError)) throw error;
      // 401 rather than a redirect, so a failed attempt is visible to anything
      // watching for them, and the same message either way.
      html(ctx, 401, page("Sign in", loginForm(error.message)));
    }
  }

  @Post("/logout")
  async logout(ctx: Ctx): Promise<void> {
    const headers = ctx.req.headers as Record<string, string | string[] | undefined>;
    const token = readCookie(firstHeader(headers["cookie"]) ?? undefined, SESSION_COOKIE);
    if (token) await this.logoutUseCase.execute(token);

    ctx.res.setHeader("set-cookie", expiredCookie());
    ctx.res.statusCode = 303;
    ctx.res.setHeader("location", "/admin/login");
    ctx.res.end();
  }

  /** Placeholder until the CRUD screens land — proves the gate, nothing else. */
  @Get("/")
  async home(ctx: Ctx): Promise<void> {
    const actor = ctx.require("actor");
    html(
      ctx,
      200,
      page(
        "Admin",
        `<h1>Signed in</h1><p>${escapeHtml(actor.email)}</p>` +
          `<form method="post" action="/admin/logout"><button type="submit">Sign out</button></form>` +
          `<p class="muted">Content screens are the rest of Phase 0b.</p>`,
      ),
    );
  }
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * The session cookie.
 *
 * `HttpOnly` so script cannot read it, `SameSite=Lax` so a cross-site form POST
 * cannot ride it — which is the CSRF defence for a cookie-authenticated admin
 * with no separate token. `Secure` follows `SECURE_COOKIES`, off by default
 * because a first install is often plain HTTP on a LAN and a cookie marked
 * Secure there simply never arrives.
 */
function sessionCookie(token: string, expiresAt: Date): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (getEnv("SECURE_COOKIES") === true) parts.push("Secure");
  return parts.join("; ");
}

function expiredCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function html(ctx: Ctx, status: number, body: string): void {
  ctx.res.statusCode = status;
  ctx.res.setHeader("content-type", "text/html; charset=utf-8");
  // The admin is never a search result.
  ctx.res.setHeader("x-robots-tag", "noindex, nofollow");
  ctx.res.end(body);
}

function escapeHtml(value: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (c) => map[c]!);
}

function loginForm(error?: string): string {
  return (
    (error ? `<p class="error">${escapeHtml(error)}</p>` : "") +
    `<h1>Sign in</h1>
<form method="post" action="/admin/login">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="username" required autofocus>
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Sign in</button>
</form>`
  );
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)}</title><style>
:root{color-scheme:light dark}
body{font:16px/1.6 system-ui,sans-serif;margin:0;padding:2rem;max-width:26rem;margin-inline:auto}
h1{font-size:1.25rem}
label{display:block;margin:1rem 0 .25rem;font-size:.875rem}
input{width:100%;padding:.6rem;font:inherit;border:1px solid #ccc;border-radius:4px}
button{margin-top:1.25rem;padding:.6rem 1rem;font:inherit;border:0;border-radius:4px;background:#1a7f5a;color:#fff}
.error{padding:.6rem .8rem;border-radius:4px;background:#fee2e2;color:#991b1b;font-size:.875rem}
.muted{color:#78716c;font-size:.875rem}
</style></head><body>${body}</body></html>`;
}
