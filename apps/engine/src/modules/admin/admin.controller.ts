/**
 * Signing in and out.
 *
 * The deny-by-default surface: nothing in this module is reachable without a
 * session except the two routes flagged `auth.public`, which are the login form
 * and its POST (ADR 0008 §4).
 */
import { Controller, Get, Inject, Post, type Ctx } from "@forinda/kickjs";
import { InvalidCredentialsError, LoginUseCase, LogoutUseCase } from "@/shared/auth/auth.usecase";

import { readCookie, SESSION_COOKIE } from "@/contributors/actor.contributor";
import { PublicAuth } from "@/route-flags";
import { clientIp, expiredCookie, firstHeader, html, sessionCookie } from "./utils/http";
import { loginForm, page } from "./utils/view";

@Controller()
export class AdminController {
  @Inject(LoginUseCase) private readonly loginUseCase!: LoginUseCase;
  @Inject(LogoutUseCase) private readonly logoutUseCase!: LogoutUseCase;

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
}
