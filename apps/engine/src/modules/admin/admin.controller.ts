/**
 * Signing in and out.
 *
 * The deny-by-default surface: nothing in this module is reachable without a
 * session except the two routes flagged `auth.public`, which are the login form
 * and its POST (ADR 0008 §4).
 */
import { Controller, Get, Inject, Post, type Ctx } from "@forinda/kickjs";

import { roleOf, type Role } from "@/shared/roles";
import {
  InvalidCredentialsError,
  LoginUseCase,
  LogoutUseCase,
  TooManyAttemptsError,
} from "@/shared/auth/auth.usecase";

import { readCookie, SESSION_COOKIE } from "@/contributors/actor.contributor";
import { PublicAuth } from "@/route-flags";
import { SessionsUseCase } from "./use-cases/sessions.usecase";
import { clientIp, expiredCookie, firstHeader, html, redirect, sessionCookie } from "./utils/http";
import { sessions as sessionsView } from "./utils/sessions.view";
import { loginForm, page } from "./utils/view";

@Controller()
export class AdminController {
  @Inject(LoginUseCase) private readonly loginUseCase!: LoginUseCase;
  @Inject(LogoutUseCase) private readonly logoutUseCase!: LogoutUseCase;
  @Inject(SessionsUseCase) private readonly sessions!: SessionsUseCase;

  @Get("/login")
  @PublicAuth
  async loginForm(ctx: Ctx): Promise<void> {
    html(ctx, 200, page({ title: "Sign in", body: loginForm(), chrome: false }));
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
        ipAddress: clientIp(ctx),
      });

      ctx.res.setHeader("set-cookie", sessionCookie(session.token, session.expiresAt));
      ctx.res.statusCode = 303;
      ctx.res.setHeader("location", "/admin");
      ctx.res.end();
    } catch (error) {
      // 429 for the lockout, 401 for a bad password. Both say what they are:
      // a form that keeps answering "wrong password" to someone being
      // rate-limited is a support call, and the attacker already knows how many
      // attempts they have made.
      if (error instanceof TooManyAttemptsError) {
        return html(
          ctx,
          429,
          page({ title: "Sign in", body: loginForm(error.message), chrome: false }),
        );
      }
      if (!(error instanceof InvalidCredentialsError)) throw error;
      // 401 rather than a redirect, so a failed attempt is visible to anything
      // watching for them, and the same message either way.
      html(ctx, 401, page({ title: "Sign in", body: loginForm(error.message), chrome: false }));
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

  /**
   * Where a signed-in owner sees every session they have open.
   *
   * Including the ones `fcms login` and the MCP server hold: ADR 0015 §4 chose
   * sessions over an API-key table precisely so a terminal's access could be
   * revoked from here, and until this screen existed that was a claim rather
   * than a feature.
   */
  @Get("/sessions")
  async sessionList(ctx: Ctx): Promise<void> {
    const owner = ctx.require("actor");
    const token = this.token(ctx);

    html(
      ctx,
      200,
      page({
        role: viewerRole(ctx),
        title: "Sessions",
        trail: [{ label: "Sessions" }],
        body: sessionsView(await this.sessions.list(owner.id, token)),
      }),
    );
  }

  @Post("/sessions/:id/revoke")
  async revokeSession(ctx: Ctx): Promise<void> {
    const owner = ctx.require("actor");
    await this.sessions.revoke(
      owner.id,
      String((ctx.params as Record<string, string>)["id"]),
      this.token(ctx),
    );
    redirect(ctx, "/admin/sessions");
  }

  /** The button that matters after a laptop goes missing. */
  @Post("/sessions/revoke-others")
  async revokeOtherSessions(ctx: Ctx): Promise<void> {
    const owner = ctx.require("actor");
    const token = this.token(ctx);
    if (token) await this.sessions.revokeOthers(owner.id, token);
    redirect(ctx, "/admin/sessions");
  }

  /** This request's own session token, so the current row can be marked. */
  private token(ctx: Ctx): string | undefined {
    const headers = ctx.req.headers as Record<string, string | string[] | undefined>;
    return readCookie(firstHeader(headers["cookie"]) ?? undefined, SESSION_COOKIE);
  }
}

/** The role on the session, for the chrome to hide what it cannot open. */
const viewerRole = (ctx: Ctx): Role => roleOf(ctx.require("actor").role);
