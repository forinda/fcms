/**
 * Building an automation (ADR 0030).
 *
 * Every route here produces a whole spec and applies it, so what an integrator
 * does in a browser lands in the same history, with the same diff and the same
 * undo, as a change made from the CLI or by the assistant.
 */
import { Controller, Get, Inject, Post, type Ctx } from "@forinda/kickjs";
import type { Workflow } from "@forinda-cms/spec";

import { EntryReadUseCase, SiteSpecUseCase } from "@/shared/use-cases";
import { ACTION_REGISTRY } from "@/shared/workflows/actions";
import { WorkflowUseCase } from "@/shared/workflows/workflow.usecase";
import { AutomationEditUseCase } from "./use-cases/automation-edit.usecase";
import { automation } from "./utils/automation.view";
import { html, noSiteYet, notFound, redirect } from "./utils/http";
import { esc, page } from "./utils/view";

@Controller()
export class AutomationController {
  @Inject(SiteSpecUseCase) private readonly specs!: SiteSpecUseCase;
  @Inject(EntryReadUseCase) private readonly reader!: EntryReadUseCase;
  @Inject(WorkflowUseCase) private readonly workflows!: WorkflowUseCase;
  @Inject(AutomationEditUseCase) private readonly edits!: AutomationEditUseCase;

  @Get("/automations/:key")
  async show(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = keyOf(ctx);
    const workflow = spec?.logic.find((w) => w.key === key);
    if (!spec || !workflow) return notFound(ctx);

    const query = ctx.query as Record<string, unknown>;
    const asked = Number(query["step"]);
    const selected = Number.isInteger(asked) && workflow.steps[asked] ? asked : null;

    const runs = (await this.workflows.recent(20)).filter((r) => r.workflowKey === key).slice(0, 5);

    html(
      ctx,
      200,
      page({
        title: `${workflow.label ?? workflow.key} — automation`,
        trail: [{ label: "Automations", href: "/admin/automations" }, { label: workflow.key }],
        body: automation({
          spec,
          workflow,
          actions: ACTION_REGISTRY,
          selected,
          runs,
          error: typeof query["error"] === "string" ? query["error"] : undefined,
        }),
      }),
    );
  }

  /** A new automation: a name and what it watches. */
  @Post("/automations")
  async create(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    if (!spec) return noSiteYet(ctx);

    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const key = String(body["key"] ?? "").trim();
    const on = String(body["on"] ?? "entry.created");
    const type = String(body["type"] ?? "");

    // A trigger is a closed list plus a type, so it is a select rather than a
    // screen (ADR 0030, consequences).
    const trigger = (
      on === "schedule"
        ? { on, cron: String(body["cron"] ?? "0 9 * * *") }
        : on === "payment.succeeded"
          ? { on, ...(type ? { type } : {}) }
          : { on, type }
    ) as Workflow["trigger"];

    const result = await this.edits.create(spec, key, trigger, {
      actor: ctx.require("actor").email,
    });

    redirect(
      ctx,
      result.ok
        ? `/admin/automations/${encodeURIComponent(key)}`
        : `/admin/automations?error=${encodeURIComponent(result.error)}`,
    );
  }

  /** Add, move or remove a step — one form, the way the canvas does it. */
  @Post("/automations/:key/steps")
  async steps(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = keyOf(ctx);
    if (!spec) return noSiteYet(ctx);

    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const [op, at] = String(body["op"] ?? "").split(":");
    const index = Number(at);
    const actor = ctx.require("actor").email;

    const result = await (async () => {
      switch (op) {
        case "add":
          return this.edits.addStep(spec, key, String(body["action"] ?? "webhook.post"), { actor });
        case "up":
          return this.edits.moveStep(spec, key, index, -1, { actor });
        case "down":
          return this.edits.moveStep(spec, key, index, 1, { actor });
        case "del":
          return this.edits.removeStep(spec, key, index, { actor });
        default:
          return { ok: false as const, error: "Nothing to do." };
      }
    })();

    this.back(ctx, key, result);
  }

  /** The inspector's save: one step's key and parameters. */
  @Post("/automations/:key/step")
  async setStep(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = keyOf(ctx);
    if (!spec) return noSiteYet(ctx);

    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const index = Number(body["step"]);

    // `param__` rather than `params.x`: a dotted name can be reinterpreted as a
    // nested object by the body parser, and the flat lookup then silently
    // writes nothing — the bug the block inspector already learned.
    const params: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(body)) {
      if (!name.startsWith("param__")) continue;
      const text = typeof value === "string" ? value.trim() : value;
      if (text === "" || text === undefined) continue;
      params[name.slice(7)] = text;
    }

    const result = await this.edits.setStep(
      spec,
      key,
      index,
      { stepKey: String(body["stepKey"] ?? "").trim(), params },
      { actor: ctx.require("actor").email },
    );

    this.back(ctx, key, result, index);
  }

  @Post("/automations/:key/enabled")
  async setEnabled(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = keyOf(ctx);
    if (!spec) return noSiteYet(ctx);

    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const result = await this.edits.setEnabled(spec, key, String(body["enabled"]) === "true", {
      actor: ctx.require("actor").email,
    });

    this.back(ctx, key, result);
  }

  @Post("/automations/:key/delete")
  async remove(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = keyOf(ctx);
    if (!spec) return noSiteYet(ctx);

    const result = await this.edits.remove(spec, key, { actor: ctx.require("actor").email });
    redirect(
      ctx,
      result.ok
        ? "/admin/automations"
        : `/admin/automations?error=${encodeURIComponent(result.error)}`,
    );
  }

  /**
   * Back to the automation, with a failure in the URL rather than rendered
   * here — a refresh after a failed edit should not repeat it.
   */
  private back(
    ctx: Ctx,
    key: string,
    result: { ok: boolean; error?: string },
    step?: number,
  ): void {
    const at = step === undefined || Number.isNaN(step) ? "" : `?step=${step}`;
    const sep = at ? "&" : "?";
    redirect(
      ctx,
      `/admin/automations/${encodeURIComponent(key)}${at}${
        result.ok ? "" : `${sep}error=${encodeURIComponent(result.error ?? "")}`
      }`,
    );
  }
}

function keyOf(ctx: Ctx): string {
  return String((ctx.params as Record<string, string>)["key"] ?? "");
}

export { esc };
