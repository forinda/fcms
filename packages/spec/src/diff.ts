/**
 * Semantic diff — the instrument doc 13's central claim needs.
 *
 * Doc 13 argues that review moves to the owner because *"a spec change is
 * reviewable by the person who asked for it"*. ADR 0007's test 2 puts that to a
 * real person: show them five changes and ask what each does.
 *
 * Nothing could produce those changes. A textual diff of YAML is line noise —
 * an indentation shift reads as a change, a moved block reads as a delete plus
 * an add. **The diff has to be over the parsed structures**, because the claim
 * is about meaning, not text.
 *
 * So this answers "what changed" in the vocabulary the owner used to ask for it:
 * a field, a page, a workflow — never a line number.
 */
import type { Classification } from "./patch.js";
import type { ContentType, Field } from "./content.js";
import type { Workflow } from "./logic.js";
import type { Page } from "./pages.js";
import type { SiteSpec } from "./site.js";

export interface SpecChange {
  readonly classification: Classification;
  /** Where in the spec, for the developer view. */
  readonly path: string;
  /** One sentence a non-developer can verify. Doc 13's whole argument. */
  readonly summary: string;
  /**
   * What it costs, when that is knowable — how many entries lose a value, how
   * many pages stop resolving. **Destructive changes must always carry one**:
   * "removes a field" is not enough information to say yes to.
   */
  readonly impact?: string;
}

/** Row counts per content type, so impact can be concrete rather than abstract. */
export type EntryCounts = Readonly<Record<string, number>>;

const additive = (path: string, summary: string, impact?: string): SpecChange => ({
  classification: "additive",
  path,
  summary,
  ...(impact ? { impact } : {}),
});

const destructive = (path: string, summary: string, impact: string): SpecChange => ({
  classification: "destructive",
  path,
  summary,
  impact,
});

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function byKey<T extends { key: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((i) => [i.key, i]));
}

/** A field's user-facing name, falling back to its key when unlabelled. */
const nameOf = (f: Field) => f.label || f.name;

function diffFields(
  type: ContentType,
  before: readonly Field[],
  after: readonly Field[],
  counts: EntryCounts,
): SpecChange[] {
  const out: SpecChange[] = [];
  const b = new Map(before.map((f) => [f.name, f]));
  const a = new Map(after.map((f) => [f.name, f]));
  const rows = counts[type.key] ?? 0;
  const at = (name: string) => `/content/${type.key}/fields/${name}`;

  for (const [name, field] of a) {
    if (b.has(name)) continue;
    const required = "required" in field && field.required === true;
    out.push(
      additive(
        at(name),
        `Adds a ${nameOf(field)} field to ${type.label}.`,
        rows === 0
          ? undefined
          : required
            ? `${plural(rows, `existing ${type.label.toLowerCase()}`)} will need this filled in.`
            : `It is optional, so ${plural(rows, `existing ${type.label.toLowerCase()}`)} will have it empty.`,
      ),
    );
  }

  for (const [name, field] of b) {
    if (a.has(name)) continue;
    out.push(
      destructive(
        at(name),
        `Removes the ${nameOf(field)} field from ${type.label}.`,
        rows === 0
          ? "No entries exist yet, so nothing is lost."
          : `Whatever is stored in it for ${plural(rows, `existing ${type.label.toLowerCase()}`)} will be deleted.`,
      ),
    );
  }

  for (const [name, before_] of b) {
    const after_ = a.get(name);
    if (!after_) continue;

    if (before_.type !== after_.type) {
      out.push(
        destructive(
          at(name),
          `Changes ${nameOf(before_)} on ${type.label} from ${before_.type} to ${after_.type}.`,
          rows === 0
            ? "No entries exist yet, so nothing is lost."
            : `Existing values may not convert, and ${plural(rows, "entry", "entries")} could lose them.`,
        ),
      );
      continue;
    }
    if (nameOf(before_) !== nameOf(after_)) {
      out.push(
        additive(at(name), `Renames ${nameOf(before_)} to ${nameOf(after_)} on ${type.label}.`),
      );
    }
    const wasRequired = "required" in before_ && before_.required === true;
    const nowRequired = "required" in after_ && after_.required === true;
    if (!wasRequired && nowRequired) {
      out.push(
        destructive(
          at(name),
          `Makes ${nameOf(after_)} required on ${type.label}.`,
          rows === 0
            ? "No entries exist yet."
            : `${plural(rows, "existing entry", "existing entries")} may be left invalid until filled in.`,
        ),
      );
    }
    if (wasRequired && !nowRequired) {
      out.push(additive(at(name), `Makes ${nameOf(after_)} optional on ${type.label}.`));
    }
  }

  return out;
}

function diffContent(before: SiteSpec, after: SiteSpec, counts: EntryCounts): SpecChange[] {
  const out: SpecChange[] = [];
  const b = byKey(before.content);
  const a = byKey(after.content);

  for (const [key, type] of a) {
    if (b.has(key)) continue;
    out.push(
      additive(
        `/content/${key}`,
        `Adds a new ${type.label} type with ${plural(type.fields.length, "field")}.`,
      ),
    );
  }

  for (const [key, type] of b) {
    if (a.has(key)) continue;
    const rows = counts[key] ?? 0;
    out.push(
      destructive(
        `/content/${key}`,
        `Removes the ${type.label} type entirely.`,
        rows === 0
          ? "No entries exist yet, so nothing is lost."
          : `All ${plural(rows, `${type.label.toLowerCase()} record`)} will be deleted.`,
      ),
    );
  }

  for (const [key, before_] of b) {
    const after_ = a.get(key);
    if (!after_) continue;
    if (before_.label !== after_.label) {
      out.push(
        additive(`/content/${key}`, `Renames the ${before_.label} type to ${after_.label}.`),
      );
    }
    out.push(...diffFields(after_, before_.fields, after_.fields, counts));
  }

  return out;
}

/**
 * A page's blocks as a list of identities, so a reorder reads as a reorder.
 *
 * Type alone is not enough, and the first version of this made that mistake:
 * the salon homepage has a "The team" section and a "What we do" section with
 * identical shape (`section > heading, list > card`), so swapping them produced
 * an identical outline and the diff reported no change at all. Reordering
 * sections is one of the most common things an owner asks for — a differ that
 * cannot see it is not usable for review.
 *
 * Identity is the block type plus its first human-readable attribute, which is
 * what actually distinguishes two sections to a reader.
 */
function blockOutline(page: Page): string[] {
  const out: string[] = [];
  const label = (attrs: Record<string, unknown> | undefined): string => {
    for (const key of ["text", "heading", "label", "title"]) {
      const value = attrs?.[key];
      if (typeof value === "string" && value.length > 0) return `:${value}`;
    }
    return "";
  };
  const walk = (
    blocks: readonly {
      type: string;
      attrs?: Record<string, unknown>;
      children?: unknown[];
      item?: unknown[];
    }[],
  ) => {
    for (const b of blocks) {
      out.push(`${b.type}${label(b.attrs)}`);
      if (Array.isArray(b.children)) walk(b.children as never);
      if (Array.isArray(b.item)) walk(b.item as never);
    }
  };
  walk(page.blocks as never);
  return out;
}

function diffPages(before: SiteSpec, after: SiteSpec): SpecChange[] {
  const out: SpecChange[] = [];
  const b = byKey(before.pages);
  const a = byKey(after.pages);

  for (const [key, page] of a) {
    if (!b.has(key)) out.push(additive(`/pages/${key}`, `Adds a page at ${page.path}.`));
  }

  for (const [key, page] of b) {
    if (a.has(key)) continue;
    // The highest-cost change on the list, and the one an owner is least likely
    // to anticipate: doc 08 makes automatic redirects structural precisely
    // because a removed URL is how a business loses its search traffic.
    out.push(
      destructive(
        `/pages/${key}`,
        `Removes the page at ${page.path}.`,
        "Anyone with that link, and any search result pointing at it, will stop working unless a redirect is set up.",
      ),
    );
  }

  for (const [key, before_] of b) {
    const after_ = a.get(key);
    if (!after_) continue;

    if (before_.path !== after_.path) {
      out.push(
        destructive(
          `/pages/${key}`,
          `Moves the ${after_.title} page from ${before_.path} to ${after_.path}.`,
          "The old address stops working unless a redirect is set up.",
        ),
      );
    }
    if (before_.title !== after_.title) {
      out.push(additive(`/pages/${key}`, `Renames the ${before_.title} page to ${after_.title}.`));
    }
    if (before_.draft !== after_.draft) {
      out.push(
        after_.draft
          ? destructive(
              `/pages/${key}`,
              `Unpublishes the ${after_.title} page.`,
              "It stops being visible to the public.",
            )
          : additive(`/pages/${key}`, `Publishes the ${after_.title} page.`),
      );
    }

    const bo = blockOutline(before_);
    const ao = blockOutline(after_);
    if (bo.join() !== ao.join()) {
      const readable = (id: string) => id.split(":").slice(1).join(":") || id;
      const added = ao.filter((t) => !bo.includes(t)).map(readable);
      const removed = bo.filter((t) => !ao.includes(t)).map(readable);
      if (added.length === 0 && removed.length === 0) {
        out.push(
          additive(`/pages/${key}/blocks`, `Reorders the sections on the ${after_.title} page.`),
        );
      } else {
        const parts: string[] = [];
        if (added.length > 0) parts.push(`adds ${added.join(", ")}`);
        if (removed.length > 0) parts.push(`removes ${removed.join(", ")}`);
        out.push(
          removed.length > 0
            ? destructive(
                `/pages/${key}/blocks`,
                `Changes the ${after_.title} page — ${parts.join(" and ")}.`,
                "Content in the removed sections is not kept.",
              )
            : additive(
                `/pages/${key}/blocks`,
                `Changes the ${after_.title} page — ${parts.join(" and ")}.`,
              ),
        );
      }
    }
  }

  return out;
}

/** Trigger phrasing, written as the owner would describe the rule. */
function describeTrigger(w: Workflow): string {
  switch (w.trigger.on) {
    case "entry.created":
      return `when a new ${w.trigger.type} is created`;
    case "entry.updated":
      return `when a ${w.trigger.type} changes`;
    case "entry.transitioned":
      return w.trigger.to
        ? `when a ${w.trigger.type} becomes ${w.trigger.to}`
        : `when a ${w.trigger.type} changes status`;
    case "form.submitted":
      return `when the ${w.trigger.form} form is submitted`;
    case "flow.completed":
      return `when someone finishes the ${w.trigger.flow} flow`;
    case "schedule":
      return `on a schedule (${w.trigger.cron})`;
  }
}

function diffLogic(before: SiteSpec, after: SiteSpec): SpecChange[] {
  const out: SpecChange[] = [];
  const b = byKey(before.logic);
  const a = byKey(after.logic);

  for (const [key, w] of a) {
    if (!b.has(key)) {
      out.push(
        additive(
          `/logic/${key}`,
          `Adds an automation: ${describeTrigger(w)}, ${plural(w.steps.length, "action")} runs.`,
        ),
      );
    }
  }
  for (const [key, w] of b) {
    if (!a.has(key)) {
      out.push(
        destructive(
          `/logic/${key}`,
          `Removes the automation that runs ${describeTrigger(w)}.`,
          "It stops happening.",
        ),
      );
    }
  }
  for (const [key, before_] of b) {
    const after_ = a.get(key);
    if (!after_) continue;
    if (before_.enabled && !after_.enabled) {
      out.push(
        destructive(
          `/logic/${key}`,
          `Turns off the automation that runs ${describeTrigger(after_)}.`,
          "It stops happening.",
        ),
      );
    }
    if (!before_.enabled && after_.enabled) {
      out.push(
        additive(`/logic/${key}`, `Turns on the automation that runs ${describeTrigger(after_)}.`),
      );
    }
    if (!same(before_.steps, after_.steps)) {
      out.push(additive(`/logic/${key}/steps`, `Changes what happens ${describeTrigger(after_)}.`));
    }
  }
  return out;
}

function diffWiring(before: SiteSpec, after: SiteSpec): SpecChange[] {
  const out: SpecChange[] = [];
  const b = byKey(before.wiring);
  const a = byKey(after.wiring);
  for (const [key, i] of a) {
    if (!b.has(key)) out.push(additive(`/wiring/${key}`, `Connects ${i.label ?? i.kind}.`));
  }
  for (const [key, i] of b) {
    if (!a.has(key)) {
      out.push(
        destructive(
          `/wiring/${key}`,
          `Disconnects ${i.label ?? i.kind}.`,
          "Anything relying on it stops working.",
        ),
      );
    }
  }
  return out;
}

/**
 * Deep equality that ignores key order.
 *
 * `JSON.stringify(a) !== JSON.stringify(b)` looks like a free deep comparison
 * and is not: it compares *insertion order*. A spec that has been through
 * Postgres comes back with `jsonb`'s own key order, so a spec compared against
 * the copy of itself that was just stored reported changed colours and a
 * changed layout — `fcms plan` invented two edits immediately after a
 * successful `fcms apply`, on every site.
 *
 * Arrays keep their order, because in a spec an array *is* ordered: blocks on a
 * page and steps in a flow mean something different rearranged.
 */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => same(item, b[i]));
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && same(left[key], right[key]));
}

function diffSite(before: SiteSpec, after: SiteSpec): SpecChange[] {
  const out: SpecChange[] = [];
  if (before.name !== after.name) {
    out.push(additive("/name", `Renames the site from ${before.name} to ${after.name}.`));
  }
  if (!same(before.theme.colors, after.theme.colors)) {
    out.push(additive("/theme/colors", "Changes the site colours. This affects every page."));
  }
  if (!same(before.theme.fonts, after.theme.fonts)) {
    out.push(additive("/theme/fonts", "Changes the site fonts. This affects every page."));
  }
  if (!same(before.layout, after.layout)) {
    out.push(additive("/layout", "Changes the header or footer, which appear on every page."));
  }
  return out;
}

/**
 * What changed, in the owner's vocabulary.
 *
 * Destructive changes sort first: the review question is "is anything about to
 * be lost", and burying that under six renames is how a reviewer says yes to
 * something they did not read.
 */
export function diffSpecs(
  before: SiteSpec,
  after: SiteSpec,
  counts: EntryCounts = {},
): SpecChange[] {
  const changes = [
    ...diffSite(before, after),
    ...diffContent(before, after, counts),
    ...diffPages(before, after),
    ...diffLogic(before, after),
    ...diffWiring(before, after),
  ];
  return changes.sort((x, y) =>
    x.classification === y.classification ? 0 : x.classification === "destructive" ? -1 : 1,
  );
}

export function summarise(changes: readonly SpecChange[]): {
  total: number;
  destructive: number;
  classification: Classification;
} {
  const destructiveCount = changes.filter((c) => c.classification === "destructive").length;
  return {
    total: changes.length,
    destructive: destructiveCount,
    classification: destructiveCount > 0 ? "destructive" : "additive",
  };
}
