/**
 * "Tell it what you want" (ADR 0018).
 *
 * One text box, one diff, two buttons. The model proposes a whole spec, the
 * same classifier that guards every other surface describes it in the owner's
 * words, and **a person presses Apply** — doc 04 permits auto-applying additive
 * changes and this deliberately does not, because doc 14's owner has no staging
 * site and "it changed something and I do not know what" is unrecoverable trust
 * even when the change itself is one click of undo.
 *
 * The proposal is carried in the form rather than held on the server: a session
 * that remembers a pending spec is a session that applies the wrong one after a
 * restart, and this way the thing being applied is the thing that was shown.
 */
import { Controller, Get, Inject, Post, type Ctx } from "@forinda/kickjs";

import { roleOf } from "@/shared/roles";
import { SiteSpec } from "@forinda-cms/spec";
import { parseSpec } from "@forinda-cms/lang";

import { SiteSpecUseCase } from "@/shared/use-cases";
import { ApplySpecUseCase, DestructiveChangeError } from "./use-cases/apply-spec.usecase";
import { AssistUseCase, type Suggestion } from "./use-cases/assist.usecase";
import { assist } from "./utils/assist.view";
import { html, noSiteYet, redirect } from "./utils/http";
import { page as shell } from "./utils/view";

@Controller()
export class AssistController {
  @Inject(SiteSpecUseCase) private readonly specs!: SiteSpecUseCase;
  @Inject(AssistUseCase) private readonly assistant!: AssistUseCase;
  @Inject(ApplySpecUseCase) private readonly applySpec!: ApplySpecUseCase;

  @Get("/assist")
  async form(ctx: Ctx): Promise<void> {
    this.render(ctx, { available: this.assistant.available });
  }

  @Post("/assist")
  async ask(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    if (!spec) return noSiteYet(ctx);

    const instruction = String((ctx.body as Record<string, unknown>)["instruction"] ?? "").trim();
    if (instruction === "") {
      return this.render(ctx, { available: this.assistant.available });
    }

    const suggestion = await this.assistant.suggest(spec, instruction);
    this.render(ctx, { available: this.assistant.available, instruction, suggestion });
  }

  /**
   * Apply what was shown.
   *
   * Re-validated here rather than trusted: the spec arrived through a form, and
   * a form is a caller like any other.
   */
  @Post("/assist/apply")
  async apply(ctx: Ctx): Promise<void> {
    const body = ctx.body as Record<string, unknown>;
    const instruction = String(body["instruction"] ?? "");
    const parsed = parseSpec(String(body["spec"] ?? ""));

    if (!parsed.ok) {
      return this.render(ctx, {
        available: this.assistant.available,
        instruction,
        suggestion: { kind: "invalid", detail: "That proposal is no longer valid." },
      });
    }

    try {
      await this.applySpec.execute(SiteSpec.parse(parsed.spec), {
        actor: ctx.require("actor").email,
        // The assistant acts as the person asking, never above them (ADR 0008
        // §2): a manager asking the chat for custom CSS is refused exactly the
        // way the screen refuses it.
        role: roleOf(ctx.require("actor").role),
        // History says which door a change came through, and this one is worth
        // being able to query on its own.
        source: "chat",
        allowDestructive: body["confirm"] === "true",
      });
      return redirect(ctx, "/admin/history");
    } catch (error) {
      if (!(error instanceof DestructiveChangeError)) throw error;
      // Shown again with the gate's own words, and a button that confirms.
      return this.render(ctx, {
        available: this.assistant.available,
        instruction,
        suggestion: {
          kind: "spec",
          spec: SiteSpec.parse(parsed.spec),
          yaml: String(body["spec"] ?? ""),
          changes: error.changes,
          destructive: error.changes.length,
          initial: false,
        },
        refused: error.message,
      });
    }
  }

  private render(
    ctx: Ctx,
    options: {
      available: boolean;
      instruction?: string;
      suggestion?: Suggestion;
      refused?: string;
    },
  ): void {
    html(
      ctx,
      200,
      shell({
        title: "Assistant",
        trail: [{ label: "Assistant" }],
        body: assist(options),
      }),
    );
  }
}
