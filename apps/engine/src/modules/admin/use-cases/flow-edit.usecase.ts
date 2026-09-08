/**
 * Building a customer's journey (ADR 0040).
 *
 * A `flow` is the steps somebody goes through on a page — choose a service,
 * choose who does it, pick a time, confirm — and it was the last part of the
 * spec with no screen at all: not on the canvas, which edits a page's blocks,
 * and not in the automation builder, which edits what happens afterwards.
 *
 * Same shape as every other builder: produce a whole spec, send it through
 * `ApplySpecUseCase`, inherit the diff, the history and the undo.
 */
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";
import { SiteSpec, type Block, type ContentType, type Page } from "@forinda-cms/spec";

import type { Role } from "@/shared/roles";
import { ApplySpecUseCase } from "./apply-spec.usecase";

export interface EditInput {
  readonly actor: string;
  /** What this person may propose — checked once, at the apply (ADR 0041). */
  readonly role: Role;
  readonly allowDestructive?: boolean;
}

export type EditResult = { ok: true; seq: number } | { ok: false; error: string };

type Flow = NonNullable<Page["flows"]>[number];
type FlowStep = Flow["steps"][number];

export interface StepSettings {
  readonly label: string;
  /** The type whose rows this step offers, or "" for a step that just confirms. */
  readonly from?: string | undefined;
  /** The field on the entry being created that the choice fills. */
  readonly as?: string | undefined;
}

@Service({ scope: Lifetime.REQUEST })
export class FlowEditUseCase {
  constructor(@Inject(ApplySpecUseCase) private readonly applySpec: ApplySpecUseCase) {}

  /**
   * A new journey, with the two steps that make it one.
   *
   * The schema wants at least two, and a journey with one step is a form. So
   * this asks the two questions a journey actually has — what does the
   * customer choose, and what is being booked — and builds a choosing step and
   * a confirming step from the answers.
   */
  create(
    spec: SiteSpec,
    pageKey: string,
    key: string,
    choose: string,
    creates: string,
    input: EditInput,
  ) {
    return this.edit(spec, pageKey, input, (flows, page) => {
      if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(key)) return "Use lowercase words joined by -.";
      if (flows.some((f) => f.key === key)) return `This page already has a "${key}" journey.`;

      const source = spec.content.find((t) => t.key === choose);
      const target = spec.content.find((t) => t.key === creates);
      if (!source) return "Say what the customer chooses from.";
      if (!target) return "Say what the journey creates.";

      // The field the first choice fills: a reference on the target pointing at
      // the source. Without one the choice is collected and written nowhere,
      // which is the "looks configured, does nothing" failure again.
      const binding = referenceTo(target, source.key);
      if (!binding) {
        return `A ${target.label.toLowerCase()} has no field pointing at ${source.label.toLowerCase()}, so the choice would be collected and written nowhere. Add one first.`;
      }

      flows.push({
        key,
        steps: [
          {
            key: source.key,
            label: `Choose a ${source.label.toLowerCase()}`,
            selects: { from: source.key, as: binding },
            blocks: [choiceList(source)],
          },
          {
            key: "confirm",
            label: "Confirm",
            requires: [source.key],
            blocks: [confirmForm(target)],
          },
        ] as FlowStep[],
      } as Flow);
      void page;
      return null;
    });
  }

  addStep(spec: SiteSpec, pageKey: string, flowKey: string, from: string, input: EditInput) {
    return this.edit(spec, pageKey, input, (flows) => {
      const flow = flows.find((f) => f.key === flowKey);
      if (!flow) return "That journey no longer exists.";

      const source = spec.content.find((t) => t.key === from);
      if (!source) return "Say what this step offers.";
      if (flow.steps.some((s) => s.key === source.key)) {
        return `This journey already has a ${source.label.toLowerCase()} step.`;
      }

      const target = targetOf(flow, spec);
      const binding = target ? referenceTo(target, source.key) : undefined;
      if (!binding) {
        return target
          ? `A ${target.label.toLowerCase()} has no field pointing at ${source.label.toLowerCase()}, so this choice would go nowhere.`
          : "This journey does not create anything yet.";
      }

      // Before the confirming step, because confirming is always last — and
      // after everything else, so `requires` can name what came before it.
      const at = Math.max(0, flow.steps.length - 1);
      const previous = flow.steps[at - 1];
      flow.steps.splice(at, 0, {
        key: source.key,
        label: `Choose a ${source.label.toLowerCase()}`,
        ...(previous ? { requires: [previous.key] } : {}),
        selects: { from: source.key, as: binding },
        blocks: [choiceList(source)],
      } as FlowStep);

      // The confirming step now comes after the new one.
      const last = flow.steps[flow.steps.length - 1]!;
      (last as { requires?: string[] }).requires = [source.key];
      return null;
    });
  }

  updateStep(
    spec: SiteSpec,
    pageKey: string,
    flowKey: string,
    stepKey: string,
    settings: StepSettings,
    input: EditInput,
  ) {
    return this.edit(spec, pageKey, input, (flows) => {
      const flow = flows.find((f) => f.key === flowKey);
      const step = flow?.steps.find((s) => s.key === stepKey);
      if (!flow || !step) return "That step no longer exists.";
      if (!settings.label.trim()) return "Give the step a name.";

      (step as { label?: string }).label = settings.label.trim();

      if (!step.selects) return null;
      const source = spec.content.find((t) => t.key === settings.from);
      if (!source) return "Say what this step offers.";

      const target = targetOf(flow, spec);
      const field = settings.as?.trim() || (target ? referenceTo(target, source.key) : undefined);
      if (!field) {
        return `Say which field on the ${target?.label.toLowerCase() ?? "entry"} this choice fills.`;
      }
      if (target && !target.fields.some((f) => f.name === field)) {
        return `${target.label} has no field called "${field}".`;
      }

      const changedSource = step.selects.from !== source.key;
      (step as { selects?: { from: string; as: string } }).selects = {
        from: source.key,
        as: field,
      };
      // The list on the step shows rows of the type it offers, so changing the
      // type has to change the list — otherwise the step says "choose a
      // stylist" over a list of services.
      if (changedSource) (step as { blocks: Block[] }).blocks = [choiceList(source)];
      return null;
    });
  }

  moveStep(
    spec: SiteSpec,
    pageKey: string,
    flowKey: string,
    index: number,
    delta: number,
    input: EditInput,
  ) {
    return this.edit(spec, pageKey, input, (flows) => {
      const flow = flows.find((f) => f.key === flowKey);
      if (!flow) return "That journey no longer exists.";
      const to = index + delta;
      if (!flow.steps[index] || !flow.steps[to]) return "That step is already at the end.";

      const [moved] = flow.steps.splice(index, 1);
      flow.steps.splice(to, 0, moved!);
      rewire(flow);
      return null;
    });
  }

  removeStep(spec: SiteSpec, pageKey: string, flowKey: string, stepKey: string, input: EditInput) {
    return this.edit(spec, pageKey, input, (flows) => {
      const flow = flows.find((f) => f.key === flowKey);
      if (!flow) return "That journey no longer exists.";
      if (flow.steps.length <= 2) return "A journey needs at least two steps.";

      const at = flow.steps.findIndex((s) => s.key === stepKey);
      if (at < 0) return "That step is already gone.";
      flow.steps.splice(at, 1);
      rewire(flow);
      return null;
    });
  }

  remove(spec: SiteSpec, pageKey: string, flowKey: string, input: EditInput) {
    return this.edit(spec, pageKey, input, (flows) => {
      const at = flows.findIndex((f) => f.key === flowKey);
      if (at < 0) return "That journey no longer exists.";
      flows.splice(at, 1);
      return null;
    });
  }

  private async edit(
    spec: SiteSpec,
    pageKey: string,
    input: EditInput,
    mutate: (flows: Flow[], page: Page) => string | null,
  ): Promise<EditResult> {
    const draft = structuredClone(spec) as SiteSpec;
    const page = draft.pages.find((p) => p.key === pageKey);
    if (!page) return { ok: false, error: "That page no longer exists." };

    const flows = (page.flows ?? []) as Flow[];
    const refusal = mutate(flows, page);
    if (refusal) return { ok: false, error: refusal };

    // Absent rather than empty: `flows: []` is a key that says nothing, and the
    // schema is strict about what a page carries.
    if (flows.length > 0) (page as { flows?: Flow[] }).flows = flows;
    else delete (page as { flows?: Flow[] }).flows;

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
        role: input.role,
        source: "flows",
        allowDestructive: input.allowDestructive === true,
      });
      return { ok: true, seq };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/**
 * What the journey creates, read from its own last step.
 *
 * The confirming step holds a `form` over a content type, which is the only
 * place a flow says what it is for. Reading it rather than storing it again
 * keeps one answer to the question.
 */
export function targetOf(flow: Flow, spec: SiteSpec): ContentType | undefined {
  for (const step of [...flow.steps].reverse()) {
    for (const block of step.blocks as Block[]) {
      const found = formTarget(block);
      if (found) return spec.content.find((t) => t.key === found);
    }
  }
  return undefined;
}

function formTarget(block: Block): string | undefined {
  if (block.type === "form" && typeof block.attrs?.["for"] === "string") {
    return block.attrs["for"];
  }
  for (const child of [...(block.children ?? []), ...(block.item ?? [])]) {
    const found = formTarget(child as Block);
    if (found) return found;
  }
  return undefined;
}

/** The reference field on `type` that points at `to`, if it has one. */
function referenceTo(type: ContentType, to: string): string | undefined {
  return type.fields.find((f) => f.type === "reference" && "to" in f && f.to === to)?.name;
}

/**
 * Each step requires the one before it, and the first requires nothing.
 *
 * The schema refuses a step that requires one coming after it, and a reordered
 * journey would otherwise be refused with a message about ordering rather than
 * simply being reordered.
 */
function rewire(flow: Flow): void {
  flow.steps.forEach((step, index) => {
    const previous = flow.steps[index - 1];
    if (previous) (step as { requires?: string[] }).requires = [previous.key];
    else delete (step as { requires?: string[] }).requires;
  });
}

/** The rows of a type, as cards somebody picks from. */
function choiceList(type: ContentType): Block {
  return {
    type: "list",
    style: { cols: { base: 1, md: 2 }, gap: "md" },
    data: { from: type.key, limit: 20 },
    item: [
      {
        type: "card",
        style: { padding: "md", border: "hairline", radius: "md" },
        attrs: { heading: `{{ item.${type.titleField ?? "name"} }}` },
      },
    ],
  } as Block;
}

/** The last step: the form that writes the entry. */
function confirmForm(type: ContentType): Block {
  return {
    type: "form",
    attrs: { for: type.key, submitLabel: `Confirm ${type.label.toLowerCase()}` },
  } as Block;
}
