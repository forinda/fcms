/**
 * Journeys on a page (ADR 0040).
 *
 * Mounted before the canvas, whose `/pages/:key` would otherwise swallow these.
 * Every route produces a whole spec and applies it, like every other builder.
 */
import { Controller, Get, Inject, Post, type Ctx } from "@forinda/kickjs";

import { SiteSpecUseCase } from "@/shared/use-cases";
import { roleOf, type Role } from "@/shared/roles";
import { FlowEditUseCase, type EditResult } from "./use-cases/flow-edit.usecase";
import { flowBuilder, flowList } from "./utils/flows.view";
import { html, noSiteYet, notFound, redirect } from "./utils/http";
import { page } from "./utils/view";

@Controller()
export class FlowsController {
  @Inject(SiteSpecUseCase) private readonly specs!: SiteSpecUseCase;
  @Inject(FlowEditUseCase) private readonly edits!: FlowEditUseCase;

  @Get("/pages/:key/flows")
  async list(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    if (!spec) return noSiteYet(ctx);
    const found = spec.pages.find((p) => p.key === keyOf(ctx));
    if (!found) return notFound(ctx);

    html(
      ctx,
      200,
      page({
        role: viewerRole(ctx),
        title: `Journeys — ${found.title}`,
        trail: [
          { label: "Pages", href: "/admin/pages" },
          { label: found.title, href: `/admin/pages/${found.key}/settings` },
          { label: "Journeys" },
        ],
        section: "pages",
        body: flowList({ spec, page: found, error: error(ctx) }),
      }),
    );
  }

  @Post("/pages/:key/flows")
  async create(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    if (!spec) return noSiteYet(ctx);

    const body = form(ctx);
    const key = str(body["key"]).trim();
    const result = await this.edits.create(
      spec,
      keyOf(ctx),
      key,
      str(body["choose"]),
      str(body["creates"]),
      { actor: actor(ctx), role: role(ctx) },
    );

    redirect(
      ctx,
      result.ok
        ? `/admin/pages/${encodeURIComponent(keyOf(ctx))}/flows/${encodeURIComponent(key)}`
        : withError(`/admin/pages/${encodeURIComponent(keyOf(ctx))}/flows`, result),
    );
  }

  @Get("/pages/:key/flows/:flow")
  async show(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    if (!spec) return noSiteYet(ctx);

    const found = spec.pages.find((p) => p.key === keyOf(ctx));
    const flow = found?.flows?.find((f) => f.key === flowOf(ctx));
    if (!found || !flow) return notFound(ctx);

    const asked = (ctx.query as Record<string, unknown>)["step"];
    const selected = flow.steps.find((s) => s.key === asked)?.key ?? null;

    html(
      ctx,
      200,
      page({
        role: viewerRole(ctx),
        title: `${flow.key} — journey`,
        trail: [
          { label: "Pages", href: "/admin/pages" },
          { label: found.title, href: `/admin/pages/${found.key}/flows` },
          { label: flow.key },
        ],
        section: "pages",
        body: flowBuilder({ spec, page: found, flow, selected, error: error(ctx) }),
      }),
    );
  }

  /** Add, move or remove a step — one form, the way the other builders do it. */
  @Post("/pages/:key/flows/:flow/steps")
  async steps(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    if (!spec) return noSiteYet(ctx);

    const body = form(ctx);
    const [op, argument] = str(body["op"]).split(":");
    const input = { actor: actor(ctx), role: role(ctx) };
    const pageKey = keyOf(ctx);
    const flowKey = flowOf(ctx);

    const result = await (async (): Promise<EditResult> => {
      switch (op) {
        case "add":
          return this.edits.addStep(spec, pageKey, flowKey, str(body["from"]), input);
        case "up":
          return this.edits.moveStep(spec, pageKey, flowKey, Number(argument), -1, input);
        case "down":
          return this.edits.moveStep(spec, pageKey, flowKey, Number(argument), 1, input);
        case "del":
          // Removing a step drops the blocks on it, which the gate calls
          // destructive. The screen says so; this is the second press.
          return this.edits.removeStep(spec, pageKey, flowKey, String(argument), {
            ...input,
            allowDestructive: true,
          });
        default:
          return { ok: false, error: "Nothing to do." };
      }
    })();

    this.back(ctx, result);
  }

  @Post("/pages/:key/flows/:flow/step")
  async step(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    if (!spec) return noSiteYet(ctx);

    const body = form(ctx);
    const stepKey = str(body["step"]);
    const result = await this.edits.updateStep(
      spec,
      keyOf(ctx),
      flowOf(ctx),
      stepKey,
      { label: str(body["label"]), from: str(body["from"]), as: str(body["as"]) },
      { actor: actor(ctx), role: role(ctx) },
    );

    this.back(ctx, result, stepKey);
  }

  @Post("/pages/:key/flows/:flow/delete")
  async remove(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    if (!spec) return noSiteYet(ctx);

    const result = await this.edits.remove(spec, keyOf(ctx), flowOf(ctx), {
      actor: actor(ctx),
      role: role(ctx),
      // Everything a journey holds is on the journey. Removing it is what the
      // button says it is, and history keeps the whole thing.
      allowDestructive: true,
    });

    if (result.ok) return redirect(ctx, `/admin/pages/${encodeURIComponent(keyOf(ctx))}/flows`);
    this.back(ctx, result);
  }

  private back(ctx: Ctx, result: EditResult, step?: string): void {
    const at = `/admin/pages/${encodeURIComponent(keyOf(ctx))}/flows/${encodeURIComponent(flowOf(ctx))}`;
    const query = new URLSearchParams();
    if (step) query.set("step", step);
    if (!result.ok) query.set("error", result.error);
    const search = query.toString();
    redirect(ctx, search ? `${at}?${search}` : at);
  }
}

const keyOf = (ctx: Ctx): string => String((ctx.params as Record<string, string>)["key"] ?? "");
const flowOf = (ctx: Ctx): string => String((ctx.params as Record<string, string>)["flow"] ?? "");
const actor = (ctx: Ctx): string => ctx.require("actor").email;
/** The role on the session, never a role a request can claim for itself. */
const role = (ctx: Ctx): Role => roleOf(ctx.require("actor").role);
const form = (ctx: Ctx): Record<string, unknown> => (ctx.body ?? {}) as Record<string, unknown>;
const error = (ctx: Ctx): string | undefined => {
  const asked = (ctx.query as Record<string, unknown>)["error"];
  return typeof asked === "string" ? asked : undefined;
};
const withError = (at: string, result: EditResult): string =>
  result.ok ? at : `${at}?error=${encodeURIComponent(result.error)}`;
const str = (value: unknown): string =>
  typeof value === "string" ? value : Array.isArray(value) ? str(value[value.length - 1]) : "";

/** The role on the session, for the chrome to hide what it cannot open. */
const viewerRole = (ctx: Ctx): Role => roleOf(ctx.require("actor").role);
