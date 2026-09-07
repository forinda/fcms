/**
 * Editing an automation (ADR 0030 §1).
 *
 * The same shape `PageEditUseCase` has, and for the same reason: every change
 * produces the whole spec and sends it through `ApplySpecUseCase`, so an
 * automation edited in a browser inherits the diff, the history, the undo and
 * the destructive gate without this file knowing they exist.
 */
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";
import { SiteSpec, type Workflow } from "@forinda-cms/spec";

import { ACTION_REGISTRY, type ActionParam } from "@/shared/workflows/actions";
import { ApplySpecUseCase } from "./apply-spec.usecase";

export interface EditInput {
  readonly actor: string;
}

export type EditResult = { ok: true; seq: number } | { ok: false; error: string };

@Service({ scope: Lifetime.REQUEST })
export class AutomationEditUseCase {
  constructor(@Inject(ApplySpecUseCase) private readonly applySpec: ApplySpecUseCase) {}

  /** A new automation, with one step so it is something rather than a name. */
  create(spec: SiteSpec, key: string, trigger: Workflow["trigger"], input: EditInput) {
    return this.edit(spec, input, (logic) => {
      if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(key)) return "Use lowercase words joined by -.";
      if (logic.some((w) => w.key === key))
        return `There is already an automation called "${key}".`;

      logic.push({
        key,
        trigger,
        steps: [{ action: "webhook.post", params: {} }],
        enabled: true,
      } as Workflow);
      return null;
    });
  }

  /**
   * Add a step, already answerable.
   *
   * A step's required parameters are filled with the first legal value rather
   * than left empty, because every applied spec has to be valid — and a builder
   * where "add a step" then "configure it" are two applies would refuse the
   * first one. The value is a real choice the panel then shows, not a
   * placeholder that means nothing.
   *
   * Where there is no legal value — an action that posts to a webhook on a site
   * with no webhook declared — this refuses and says so, which is more useful
   * than a step that cannot run.
   */
  addStep(spec: SiteSpec, key: string, action: string, input: EditInput) {
    return this.edit(spec, input, (logic) => {
      const workflow = logic.find((w) => w.key === key);
      if (!workflow) return "That automation no longer exists.";

      const declared = ACTION_REGISTRY[action];
      if (!declared) return `Nothing implements "${action}".`;

      const params: Record<string, unknown> = {};
      for (const param of declared.params) {
        if (!param.required) continue;

        const value = firstLegalValue(param, spec, workflow);
        if (value === null) {
          return param.kind === "integration"
            ? `This site has no ${param.of} to send to yet — declare one first.`
            : `There is nothing to choose for "${param.label}" yet.`;
        }
        params[param.name] = value;
      }

      workflow.steps.push({ action, params } as Workflow["steps"][number]);
      return null;
    });
  }

  removeStep(spec: SiteSpec, key: string, index: number, input: EditInput) {
    return this.edit(spec, input, (logic) => {
      const workflow = logic.find((w) => w.key === key);
      if (!workflow?.steps[index]) return "That step no longer exists.";
      // A pipeline with no steps is a trigger that fires and does nothing,
      // which the schema refuses — so the last step cannot be removed.
      if (workflow.steps.length === 1) return "An automation needs at least one step.";

      workflow.steps.splice(index, 1);
      return null;
    });
  }

  moveStep(spec: SiteSpec, key: string, index: number, delta: number, input: EditInput) {
    return this.edit(spec, input, (logic) => {
      const workflow = logic.find((w) => w.key === key);
      const to = index + delta;
      if (!workflow?.steps[index]) return "That step no longer exists.";
      if (to < 0 || to >= workflow.steps.length) return "It is already at the end.";

      const [moved] = workflow.steps.splice(index, 1);
      workflow.steps.splice(to, 0, moved!);
      return null;
    });
  }

  /**
   * Replace one step's parameters.
   *
   * Assigned rather than merged: the panel always submits every field it shows,
   * so a merge would make clearing a value impossible — the same reasoning the
   * block inspector follows.
   */
  setStep(
    spec: SiteSpec,
    key: string,
    index: number,
    next: { stepKey?: string; params: Record<string, unknown> },
    input: EditInput,
  ) {
    return this.edit(spec, input, (logic) => {
      const workflow = logic.find((w) => w.key === key);
      const step = workflow?.steps[index];
      if (!step) return "That step no longer exists.";

      step.params = Object.keys(next.params).length > 0 ? (next.params as never) : undefined;
      if (next.stepKey !== undefined) {
        step.key = next.stepKey === "" ? undefined : next.stepKey;
      }
      return null;
    });
  }

  /** Turn one off without deleting it — the automation equivalent of unpublish. */
  setEnabled(spec: SiteSpec, key: string, enabled: boolean, input: EditInput) {
    return this.edit(spec, input, (logic) => {
      const workflow = logic.find((w) => w.key === key);
      if (!workflow) return "That automation no longer exists.";
      workflow.enabled = enabled;
      return null;
    });
  }

  remove(spec: SiteSpec, key: string, input: EditInput) {
    return this.edit(spec, input, (logic) => {
      const at = logic.findIndex((w) => w.key === key);
      if (at < 0) return "That automation no longer exists.";
      logic.splice(at, 1);
      return null;
    });
  }

  /**
   * One edit: copy the spec, change the copy, validate it, apply it.
   *
   * The copy matters for the reason it matters on the canvas: mutating the
   * caller's spec would leave a half-applied automation behind when validation
   * rejects the result, and the next click would build on it.
   */
  private async edit(
    spec: SiteSpec,
    input: EditInput,
    mutate: (logic: Workflow[]) => string | null,
  ): Promise<EditResult> {
    const draft = structuredClone(spec) as SiteSpec & { logic: Workflow[] };
    const refusal = mutate(draft.logic);
    if (refusal) return { ok: false, error: refusal };

    const validated = SiteSpec.safeParse(draft);
    if (!validated.success) {
      return {
        ok: false,
        error: validated.error.issues[0]?.message ?? "That change is not valid.",
      };
    }

    try {
      const { seq } = await this.applySpec.execute(validated.data, {
        actor: input.actor,
        source: "automations",
        // Deleting an automation is a change an owner made by pressing delete;
        // the gate still refuses anything else destructive in the same apply.
        allowDestructive: true,
      });
      return { ok: true, seq };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/**
 * The first value a parameter may legally take on this site.
 *
 * Null when there is none, which is a refusal rather than a guess: a step
 * pointing at an integration nobody declared is exactly the "looks configured,
 * does nothing" failure this project keeps refusing to ship.
 */
function firstLegalValue(param: ActionParam, spec: SiteSpec, workflow: Workflow): string | null {
  if (param.kind === "integration") {
    const found = spec.wiring.find(
      (i) => (!param.of || i.kind === param.of) && i.enabled !== false,
    );
    return found?.key ?? null;
  }

  if (param.kind === "state") {
    const typeKey = "type" in workflow.trigger ? workflow.trigger.type : undefined;
    const state = spec.content
      .find((t) => t.key === typeKey)
      ?.fields.find((f) => f.type === "state");
    return state && "values" in state ? (state.values[0] ?? null) : null;
  }

  // No closed set to choose from, so the action says what a working starting
  // point is — and a required one without a default is a mistake in the action
  // rather than something to paper over here.
  return param.default ?? (param.required ? null : "");
}
