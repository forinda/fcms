/**
 * Adding and removing the people who can sign in (ADR 0041).
 *
 * Owner-only, checked in the use-case rather than here — the same rule the spec
 * changes follow: the check lives with the operation, so a second door onto it
 * cannot miss it.
 */
import { Controller, Get, Inject, Post, type Ctx } from "@forinda/kickjs";

import { PeopleUseCase, type PeopleResult } from "./use-cases/people.usecase";
import { html, notFound, redirect } from "./utils/http";
import { people } from "./utils/people.view";
import { page } from "./utils/view";
import { atLeast, roleOf, type Role } from "@/shared/roles";

@Controller()
export class PeopleController {
  @Inject(PeopleUseCase) private readonly staff!: PeopleUseCase;

  @Get("/people")
  async list(ctx: Ctx): Promise<void> {
    const actor = ctx.require("actor");
    // A viewer cannot see the list either: who else has access, and at what
    // level, is not something to hand to an account that cannot change it.
    if (!atLeast(roleOf(actor.role), "owner")) return notFound(ctx);

    html(
      ctx,
      200,
      page({
        role: viewerRole(ctx),
        title: "People",
        trail: [{ label: "People" }],
        section: "people",
        body: people({ people: await this.staff.list(actor.orgId), actor, error: error(ctx) }),
      }),
    );
  }

  @Post("/people")
  async add(ctx: Ctx): Promise<void> {
    const body = form(ctx);
    const result = await this.staff.add(
      { actor: ctx.require("actor") },
      {
        email: str(body["email"]),
        name: str(body["name"]),
        password: str(body["password"]),
        role: str(body["role"]),
      },
    );
    back(ctx, result);
  }

  @Post("/people/:id/role")
  async setRole(ctx: Ctx): Promise<void> {
    const result = await this.staff.setRole(
      { actor: ctx.require("actor") },
      idOf(ctx),
      str(form(ctx)["role"]),
    );
    back(ctx, result);
  }

  @Post("/people/:id/delete")
  async remove(ctx: Ctx): Promise<void> {
    const result = await this.staff.remove({ actor: ctx.require("actor") }, idOf(ctx));
    back(ctx, result);
  }
}

const idOf = (ctx: Ctx): string => String((ctx.params as Record<string, string>)["id"] ?? "");
const form = (ctx: Ctx): Record<string, unknown> => (ctx.body ?? {}) as Record<string, unknown>;
const error = (ctx: Ctx): string | undefined => {
  const asked = (ctx.query as Record<string, unknown>)["error"];
  return typeof asked === "string" ? asked : undefined;
};
const back = (ctx: Ctx, result: PeopleResult): void =>
  redirect(
    ctx,
    result.ok ? "/admin/people" : `/admin/people?error=${encodeURIComponent(result.error)}`,
  );
const str = (value: unknown): string =>
  typeof value === "string" ? value : Array.isArray(value) ? str(value[value.length - 1]) : "";

/** The role on the session, for the chrome to hide what it cannot open. */
const viewerRole = (ctx: Ctx): Role => roleOf(ctx.require("actor").role);
