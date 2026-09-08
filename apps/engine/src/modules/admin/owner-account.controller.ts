/**
 * Your own account (ADR 0042).
 *
 * `OwnerAccountController`, because the site module already has an
 * `AccountController` for a *visitor's* account (ADR 0020) and the container
 * keys services by class name. Two "accounts" on this platform: the person who
 * runs the site, and the person who books with it.
 *
 * Everyone who can sign in reaches this, whatever their role — it is theirs.
 * The one thing it will not do without the current password is change the
 * password.
 */
import { Controller, Get, Inject, Post, type Ctx } from "@forinda/kickjs";

import { roleOf, type Role } from "@/shared/roles";
import { readCookie, SESSION_COOKIE } from "@/contributors/actor.contributor";
import { AccountUseCase, type AccountResult } from "./use-cases/account.usecase";
import { firstHeader, html, redirect } from "./utils/http";
import { account } from "./utils/account.view";
import { page } from "./utils/view";

@Controller()
export class OwnerAccountController {
  @Inject(AccountUseCase) private readonly accounts!: AccountUseCase;

  @Get("/account")
  async show(ctx: Ctx): Promise<void> {
    const query = ctx.query as Record<string, unknown>;

    html(
      ctx,
      200,
      page({
        role: viewerRole(ctx),
        title: "Your account",
        trail: [{ label: "Your account" }],
        section: "account",
        body: account({
          actor: ctx.require("actor"),
          error: typeof query["error"] === "string" ? query["error"] : undefined,
          done: typeof query["done"] === "string" ? query["done"] : undefined,
        }),
      }),
    );
  }

  @Post("/account")
  async rename(ctx: Ctx): Promise<void> {
    const result = await this.accounts.rename(ctx.require("actor"), str(form(ctx)["name"]));
    back(ctx, result, "Saved.");
  }

  @Post("/account/password")
  async changePassword(ctx: Ctx): Promise<void> {
    const body = form(ctx);
    const headers = ctx.req.headers as Record<string, string | string[] | undefined>;

    const result = await this.accounts.changePassword(
      ctx.require("actor"),
      { current: str(body["current"]), next: str(body["next"]), confirm: str(body["confirm"]) },
      readCookie(firstHeader(headers["cookie"]) ?? undefined, SESSION_COOKIE),
    );

    back(
      ctx,
      result,
      result.ok && result.signedOutElsewhere > 0
        ? `Password changed, and ${result.signedOutElsewhere} other ${
            result.signedOutElsewhere === 1 ? "session was" : "sessions were"
          } signed out.`
        : "Password changed.",
    );
  }
}

const form = (ctx: Ctx): Record<string, unknown> => (ctx.body ?? {}) as Record<string, unknown>;
const str = (value: unknown): string =>
  typeof value === "string" ? value : Array.isArray(value) ? str(value[value.length - 1]) : "";

/** The role on the session, for the chrome to hide what it cannot open. */
const viewerRole = (ctx: Ctx): Role => roleOf(ctx.require("actor").role);

const back = (ctx: Ctx, result: AccountResult, done: string): void =>
  redirect(
    ctx,
    result.ok
      ? `/admin/account?done=${encodeURIComponent(done)}`
      : `/admin/account?error=${encodeURIComponent(result.error)}`,
  );
