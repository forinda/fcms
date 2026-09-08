/**
 * Turning an empty install into a site (ADR 0036).
 *
 * One route. It goes through `ApplySpecUseCase` like every other change, so the
 * site a starter produces is diffed, migrated and recorded — the first line of
 * history says which starter it was and who pressed the button.
 */
import { Controller, getEnv, Inject, Post, type Ctx } from "@forinda/kickjs";

import { roleOf } from "@/shared/roles";
import { SiteSpec } from "@forinda-cms/spec";

import { SiteSpecUseCase } from "@/shared/use-cases";
import { starterFor } from "@/shared/starters";
import { ApplySpecUseCase } from "./use-cases/apply-spec.usecase";
import { redirect } from "./utils/http";
import { untouched } from "./utils/first-run.view";

@Controller()
export class FirstRunController {
  @Inject(SiteSpecUseCase) private readonly specs!: SiteSpecUseCase;
  @Inject(ApplySpecUseCase) private readonly applySpec!: ApplySpecUseCase;

  @Post("/start")
  async start(ctx: Ctx): Promise<void> {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const starter = starterFor(String(body["starter"] ?? ""));
    if (!starter) return redirect(ctx, "/admin?error=Pick+one+of+these+to+start+from.");

    // Only while the site is still the one boot made. This applies a whole
    // spec, so on a site with anything in it the button would replace every
    // page and every type at once — which the platform can do and a button
    // should not.
    const current = await this.specs.execute();
    if (current && !untouched(current)) {
      return redirect(
        ctx,
        "/admin?error=" +
          encodeURIComponent(
            "This site already has things in it, so a starting point cannot be applied over it.",
          ),
      );
    }

    const parsed = SiteSpec.safeParse(starter.build(siteName()));
    if (!parsed.success) {
      // A starter that does not validate is a bug in this repository, not
      // something the person who pressed the button can fix.
      return redirect(
        ctx,
        "/admin?error=" +
          encodeURIComponent(`“${starter.label}” did not apply cleanly. Please report this.`),
      );
    }

    try {
      await this.applySpec.execute(parsed.data, {
        actor: ctx.require("actor").email,
        role: roleOf(ctx.require("actor").role),
        source: `starter:${starter.key}`,
        // The gate calls this destructive, and on any other site it would be:
        // it replaces the home page's blocks. Here the only thing being
        // replaced is the placeholder the installer wrote, which `untouched`
        // above has already established is all there is — and the whole change
        // is one line in history with an undo beside it.
        allowDestructive: true,
      });
    } catch (error) {
      return redirect(
        ctx,
        "/admin?error=" +
          encodeURIComponent(error instanceof Error ? error.message : String(error)),
      );
    }

    redirect(ctx, "/admin");
  }
}

/**
 * What to call the site.
 *
 * `SITE_NAME` is set at install time and is the name the person running this
 * already chose; the starter only supplies the shape. It is renamed from
 * Settings afterwards like anything else.
 */
function siteName(): string {
  const configured = getEnv("SITE_NAME");
  return configured && configured.trim() !== "" ? configured.trim() : "My site";
}
