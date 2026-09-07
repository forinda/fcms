/**
 * The whole spec document.
 *
 * ADR 0006 derives a multi-file layout from this (`site.yaml`, `content/*.yaml`,
 * `pages/*.yaml`, `logic/*.yaml`) — but the layout is a *projection*, computed
 * deterministically from the AST so `pull` is a pure function and no file
 * provenance needs storing. In memory it is one object.
 */
import { z } from "zod";

import { Access } from "./access.js";
import { ContentType } from "./content.js";
import { Workflow } from "./logic.js";
import { Block, Component, Page, collectionType } from "./pages.js";
import { Label, Note } from "./primitives.js";
import { CustomCss, Theme } from "./style.js";
import { Wiring } from "./wiring.js";

/**
 * Internal, not user-facing, and not the plugin API integer (ADR 0003/0012).
 * A `specVersion` bump is a data migration; an `api` bump is an ecosystem event.
 */
export const SPEC_VERSION = 1;

/**
 * Header and footer shared by every page (ADR 0014, decision 2).
 *
 * Doc 12 predicted the pressure for includes; it arrived on the second page of
 * the first real spec. This is the structured answer: **one level, no nesting,
 * no parameters, no named slots, no inheritance.** Those are the increments by
 * which a layout becomes a template system, and ADR 0006 already banned YAML
 * anchors for the same reason.
 */
export const SiteLayout = z
  .object({ header: z.array(Block).optional(), footer: z.array(Block).optional() })
  .strict();

export const SiteSpec = z
  .object({
    specVersion: z.literal(SPEC_VERSION),
    name: Label,
    note: Note,
    layout: SiteLayout.optional(),
    /** Site-level tier-3 CSS. Gated to the `developer` role (ADR 0004/0008). */
    css: CustomCss.optional(),
    theme: Theme,
    /**
     * Reusable block groups (ADR 0022).
     *
     * Site-level rather than a collection section, for the same reason `layout`
     * is: a component is shared chrome, it belongs beside the header and footer
     * in `site.yaml`, and putting it there means the splitter needs no change —
     * `SiteFile` is derived by omission.
     */
    components: z.array(Component).default([]),
    content: z.array(ContentType),
    pages: z.array(Page),
    logic: z.array(Workflow).default([]),
    access: Access.default({}),
    wiring: Wiring.default([]),
  })
  .strict();

export type SiteSpec = z.infer<typeof SiteSpec>;

/**
 * The sections that get their own files (ADR 0006's derived layout).
 *
 * **One list, two consumers** — the `SiteFile` schema below omits exactly these,
 * and the splitter strips exactly these. Adding a site-level field then needs no
 * change anywhere; adding a new *collection* section is a layout change, and it
 * fails loudly in both places at once rather than in neither.
 */
export const COLLECTION_SECTIONS = ["content", "pages", "logic"] as const;
export type CollectionSection = (typeof COLLECTION_SECTIONS)[number];

/**
 * What `site.yaml` holds — everything that is not a collection section.
 *
 * **Derived by omission, never hand-listed.** The splitter used to pick fields
 * one by one, so ADR 0014's `layout` and `note` were added to `SiteSpec` and
 * silently dropped on the way out: `fcms fmt` deleted a site's header and
 * footer and nothing complained. Omission cannot forget.
 *
 * Stays strict, because this is also the schema an editor validates `site.yaml`
 * against, and catching a typo'd key there is the point.
 */
const OMIT_COLLECTIONS = Object.fromEntries(COLLECTION_SECTIONS.map((k) => [k, true])) as {
  [K in CollectionSection]: true;
};

export const SiteFile = SiteSpec.omit(OMIT_COLLECTIONS);
export type SiteFile = z.infer<typeof SiteFile>;

/** Drop the collection sections, leaving exactly what `site.yaml` carries. */
export function siteFileOf(spec: SiteSpec): SiteFile {
  const rest: Record<string, unknown> = { ...spec };
  for (const section of COLLECTION_SECTIONS) delete rest[section];
  return SiteFile.parse(rest);
}

/**
 * Cross-section checks Zod cannot express, because they need the whole document.
 *
 * These are the errors that would otherwise reach a customer as a blank section
 * or a 500 — a query against a type nobody declared, a page bound to a missing
 * collection, a workflow watching a type that was renamed. Catching them in
 * `validate` is most of what makes the language safe to hand to a model.
 */
export interface SpecIssue {
  readonly path: string;
  readonly message: string;
}

export function checkReferences(spec: SiteSpec): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const types = new Map(spec.content.map((t) => [t.key, t]));
  const components = new Set(spec.components.map((c) => c.key));

  const seen = <T extends { key: string }>(items: readonly T[], where: string) => {
    const keys = items.map((i) => i.key);
    for (const dup of new Set(keys.filter((k, i) => keys.indexOf(k) !== i))) {
      issues.push({ path: where, message: `duplicate key "${dup}"` });
    }
  };
  seen(spec.components, "/components");
  seen(spec.content, "/content");
  seen(spec.pages, "/pages");
  seen(spec.logic, "/logic");

  const paths = spec.pages.map((p) => p.path);
  for (const dup of new Set(paths.filter((p, i) => paths.indexOf(p) !== i))) {
    issues.push({ path: "/pages", message: `two pages both answer "${dup}"` });
  }

  // A derived type's inputs must name real types and real fields — otherwise the
  // generator fails at request time, on a live page, instead of at validate time.
  for (const t of types.values()) {
    if (!t.derived) continue;
    const d = t.derived;
    const resource = types.get(d.resource.type);
    const occupied = types.get(d.occupied.type);
    const at = `/content/${t.key}/derived`;

    if (!resource)
      issues.push({ path: `${at}/resource`, message: `unknown content type "${d.resource.type}"` });
    else if (!resource.fields.some((f) => f.name === d.resource.hours)) {
      issues.push({
        path: `${at}/resource/hours`,
        message: `"${d.resource.type}" has no field "${d.resource.hours}"`,
      });
    }

    if (!occupied)
      issues.push({ path: `${at}/occupied`, message: `unknown content type "${d.occupied.type}"` });
    else {
      for (const key of ["resource", "start", "minutes"] as const) {
        const field = d.occupied[key];
        if (!occupied.fields.some((f) => f.name === field)) {
          issues.push({
            path: `${at}/occupied/${key}`,
            message: `"${d.occupied.type}" has no field "${field}"`,
          });
        }
      }
    }
  }

  // `reference` fields must point at a declared type.
  for (const t of types.values()) {
    for (const f of t.fields) {
      if ("to" in f && typeof f.to === "string" && !types.has(f.to)) {
        issues.push({
          path: `/content/${t.key}/fields/${f.name}`,
          message: `references unknown content type "${f.to}"`,
        });
      }
    }
  }

  // Aggregates name another type and a reference field on it. Both have to
  // exist, or the value is silently always null — which reads as "no reviews
  // yet" forever (ADR 0019 §4).
  for (const type of spec.content) {
    for (const field of type.fields) {
      if (field.type !== "aggregate") continue;
      const path = `/content/${type.key}/fields/${field.name}`;

      const related = types.get(field.of);
      if (!related) {
        issues.push({ path, message: `aggregates over unknown content type "${field.of}"` });
        continue;
      }

      const back = related.fields.find((f) => f.name === field.on);
      if (!back) {
        issues.push({
          path,
          message: `"${field.of}" has no field "${field.on}" to group by`,
        });
      } else if (back.type !== "reference") {
        issues.push({
          path,
          message: `"${field.of}.${field.on}" is a ${back.type}, not a reference back to "${type.key}"`,
        });
      } else if (back.to !== type.key) {
        issues.push({
          path,
          message: `"${field.of}.${field.on}" references "${back.to}", not "${type.key}"`,
        });
      }

      if (field.fn !== "count" && !field.field) {
        issues.push({ path, message: `${field.fn} needs a field of "${field.of}" to aggregate` });
      }
    }
  }

  // A formula naming a field that does not exist evaluates to null forever,
  // which on a price reads as "free" and on a rating as "unrated" (ADR 0019 §5).
  for (const type of spec.content) {
    const names = new Set(type.fields.map((f) => f.name));

    for (const field of type.fields) {
      if (field.type !== "computed") continue;
      const path = `/content/${type.key}/fields/${field.name}`;

      const walkFormula = (operand: unknown): void => {
        if (typeof operand !== "object" || operand === null) return;

        if ("field" in operand) {
          const named = String((operand as { field: string }).field);
          if (!names.has(named)) {
            issues.push({ path, message: `uses "${named}", which "${type.key}" does not have` });
          } else if (named === field.name) {
            // Not clever, just wrong: a field cannot be part of its own value.
            issues.push({ path, message: `refers to itself` });
          }
          return;
        }

        if ("of" in operand) {
          for (const child of (operand as { of: unknown[] }).of) walkFormula(child);
        }
      };

      walkFormula(field.formula);

      // Order matters for these two and nobody expects it not to, so a single
      // operand is almost always a mistake rather than a shorthand.
      if (
        (field.formula.op === "subtract" || field.formula.op === "divide") &&
        field.formula.of.length < 2
      ) {
        issues.push({ path, message: `${field.formula.op} needs at least two values` });
      }
    }
  }

  // Every `data.from` in every block of every page, at any depth.
  const walk = (
    blocks: readonly import("./pages.js").Block[],
    at: string,
    /** Set while walking a component's own blocks — see the nesting check. */
    insideComponent?: string,
  ) => {
    blocks.forEach((b, i) => {
      const here = `${at}/${i}`;
      if (b.type === "component") {
        const use = (b.attrs ?? {})["use"];
        if (typeof use !== "string" || !components.has(use)) {
          issues.push({
            path: `${here}/attrs/use`,
            message:
              typeof use === "string"
                ? `uses unknown component "${use}"`
                : "a component block needs `use` naming the component to place here",
          });
        } else if (insideComponent) {
          // The rule that makes cycles impossible instead of merely detectable.
          issues.push({
            path: here,
            message:
              `component "${insideComponent}" places component "${use}" — components are ` +
              `one level deep, so copy what it holds instead`,
          });
        }
        if (b.style || b.css) {
          issues.push({
            path: here,
            message: `styling belongs on the component itself, not on a place it is used`,
          });
        }
      }
      if (b.data && !types.has(b.data.from)) {
        issues.push({
          path: `${here}/data`,
          message: `queries unknown content type "${b.data.from}"`,
        });
      }
      if (b.data?.sort) {
        const t = types.get(b.data.from);
        const sort = b.data.sort;
        // Both shapes name fields: an authored sort names one, a visitor-chosen
        // sort names the closed list it will accept (ADR 0019 §2). Every one of
        // them has to exist, or the page offers an ordering that cannot run.
        const named = "field" in sort ? [sort.field] : sort.allow;

        for (const field of named) {
          if (t && !t.fields.some((f) => f.name === field)) {
            issues.push({
              path: `${here}/data/sort`,
              message: `sorts by "${field}", which "${b.data.from}" does not have`,
            });
          }
        }
      }

      // A filter the visitor drives must be indexed, or the page gets slower as
      // the business grows — which ADR 0009 calls the bug an owner cannot see.
      for (const [c, condition] of (b.data?.where ?? []).entries()) {
        if (typeof condition.value !== "object" || condition.value === null) continue;
        if (!("param" in condition.value)) continue;

        const t = types.get(b.data!.from);
        const field = t?.fields.find((f) => f.name === condition.field);
        if (t && !field) {
          issues.push({
            path: `${here}/data/where/${c}`,
            message: `filters on "${condition.field}", which "${b.data!.from}" does not have`,
          });
        } else if (field && !("filterable" in field && field.filterable === true)) {
          issues.push({
            path: `${here}/data/where/${c}`,
            message:
              `"${condition.field}" is filtered by a request parameter but is not marked ` +
              `filterable, so it has no index`,
          });
        }
      }
      if (b.item) walk(b.item, `${here}/item`, insideComponent);
      if (b.children) walk(b.children, `${here}/children`, insideComponent);
    });
  };

  for (const c of spec.components) walk(c.blocks, `/components/${c.key}/blocks`, c.key);
  walk(spec.layout?.header ?? [], "/layout/header");
  walk(spec.layout?.footer ?? [], "/layout/footer");

  for (const p of spec.pages) {
    walk(p.blocks, `/pages/${p.key}/blocks`);
    const bound = collectionType(p.collection);
    if (bound && !types.has(bound)) {
      issues.push({ path: `/pages/${p.key}`, message: `bound to unknown collection "${bound}"` });
    }
    for (const f of p.flows ?? []) {
      f.steps.forEach((step, i) => {
        walk(step.blocks, `/pages/${p.key}/flows/${f.key}/steps/${i}/blocks`);
        if (step.selects && !types.has(step.selects.from)) {
          issues.push({
            path: `/pages/${p.key}/flows/${f.key}/steps/${i}/selects`,
            message: `selects from unknown content type "${step.selects.from}"`,
          });
        }
      });
    }
  }

  // Workflows watching a type, and transition triggers naming a real state.
  for (const w of spec.logic) {
    const t = "type" in w.trigger ? w.trigger.type : undefined;
    if (t && !types.has(t)) {
      issues.push({
        path: `/logic/${w.key}/trigger`,
        message: `watches unknown content type "${t}"`,
      });
    }
    if (w.trigger.on === "entry.transitioned" && w.trigger.to && t) {
      const state = types.get(t)?.fields.find((f) => f.type === "state");
      if (state && "values" in state && !state.values.includes(w.trigger.to)) {
        issues.push({
          path: `/logic/${w.key}/trigger`,
          message: `waits for state "${w.trigger.to}", which "${t}" does not declare`,
        });
      }
    }
  }

  // A payable type must name an integration that exists and can take money.
  const integrations = new Map(spec.wiring.map((i) => [i.key, i]));
  for (const type of spec.content) {
    if (!type.payment) continue;
    const at = `/content/${type.key}/payment`;
    const integration = integrations.get(type.payment.via);

    if (!integration) {
      issues.push({ path: `${at}/via`, message: `unknown integration "${type.payment.via}"` });
    } else if (!integration.kind.startsWith("payment.")) {
      issues.push({
        path: `${at}/via`,
        message: `"${type.payment.via}" is a ${integration.kind} integration, which cannot take a payment`,
      });
    } else if (integration.enabled === false) {
      // Otherwise the form takes the booking and the payment silently never
      // happens — the failure an owner discovers from their bank statement.
      issues.push({
        path: `${at}/via`,
        message: `"${type.payment.via}" is turned off, so nothing can be charged through it`,
      });
    }
  }

  // Access rules for types that no longer exist — usually a rename left behind.
  for (const key of Object.keys(spec.access.types ?? {})) {
    if (!types.has(key)) {
      issues.push({
        path: `/access/types/${key}`,
        message: `grants access to unknown content type "${key}"`,
      });
    }
  }

  return issues;
}
