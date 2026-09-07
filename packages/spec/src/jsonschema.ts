/**
 * JSON Schema generation.
 *
 * ADR 0006 promised this and made a cost argument out of it: YAML was chosen
 * partly because *"generate JSON Schema from `packages/spec` in CI; the existing
 * YAML language server gives autocomplete, inline validation and hover docs"* —
 * which discharges most of the editor-support cost of having human authors
 * without writing an LSP.
 *
 * The same artifact is what an AI harness should be handed to author a spec, so
 * one generator serves both audiences. That is the doc 04 pattern again: one
 * governed surface, many doors.
 */
import { z } from "zod";

import { ContentType } from "./content.js";
import { Workflow } from "./logic.js";
import { Page } from "./pages.js";
import { SiteFile, SiteSpec } from "./site.js";

/**
 * `io: 'input'` matters. Several fields carry `.default()`, so the *output* type
 * has them required while the *input* type — what an author or a model actually
 * writes — does not. Emitting the output schema would reject valid specs for
 * omitting fields the platform fills in.
 */
export function siteSpecJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(SiteSpec, {
    io: "input",
    unrepresentable: "any",
    $refStrategy: "none",
  } as Parameters<typeof z.toJSONSchema>[1]) as Record<string, unknown>;
}

/**
 * One schema per file the canonical layout writes (ADR 0006).
 *
 * The whole-document schema is the wrong thing to point an editor at for most
 * files — `site.yaml` carries no `content`, so validating it against `SiteSpec`
 * reports the collections as missing and the editor confidently contradicts the
 * parser. That is the "a stale schema is worse than none" failure, one step
 * removed: not stale, just aimed at the wrong document.
 *
 * `spec` covers a single-file spec, which `parseSpec` still accepts.
 */
export function fragmentJsonSchemas(): Record<string, Record<string, unknown>> {
  const emit = (schema: z.ZodType) =>
    z.toJSONSchema(schema, {
      io: "input",
      unrepresentable: "any",
      $refStrategy: "none",
    } as Parameters<typeof z.toJSONSchema>[1]) as Record<string, unknown>;

  return {
    spec: emit(SiteSpec),
    site: emit(SiteFile),
    "content-type": emit(ContentType),
    page: emit(Page),
    workflow: emit(Workflow),
  };
}
