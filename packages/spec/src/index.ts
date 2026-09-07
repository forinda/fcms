/**
 * @forinda-cms/spec — the AST every authoring surface writes to.
 *
 * Shared by the engine, the admin, the CLI and CI (ADR 0002). The YAML profile
 * (ADR 0006) is surface syntax over these types, which is what keeps the syntax
 * swappable and this package foundational.
 */
export * from "./primitives.js";
export * from "./style.js";
export * from "./condition.js";
export * from "./query.js";
export * from "./content.js";
export * from "./pages.js";
export * from "./logic.js";
export * from "./access.js";
export * from "./wiring.js";
export * from "./patch.js";
export * from "./site.js";

import { SiteSpec, checkReferences, type SpecIssue } from "./site.js";

export type ValidationResult =
  | { readonly ok: true; readonly spec: import("./site.js").SiteSpec }
  | { readonly ok: false; readonly issues: readonly SpecIssue[] };

/**
 * Validate a parsed document: shape first, then the cross-section references.
 *
 * Both halves matter. Zod catches a malformed block; `checkReferences` catches a
 * query against a content type nobody declared — which is well-formed and still
 * renders an empty section on a live page. `fcms validate` is this function.
 */
export function validateSpec(input: unknown): ValidationResult {
  const parsed = SiteSpec.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        path: "/" + i.path.join("/"),
        message: i.message,
      })),
    };
  }
  const issues = checkReferences(parsed.data);
  return issues.length ? { ok: false, issues } : { ok: true, spec: parsed.data };
}
export * from "./jsonschema.js";
export * from "./diff.js";
export * from "./entry.js";
