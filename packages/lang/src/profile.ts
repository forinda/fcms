/**
 * The strict YAML 1.2 profile (ADR 0006).
 *
 * Plain YAML has real hazards, and two of its features are outright dangerous
 * here: **anchors and aliases are how a config language grows variables and
 * inheritance**, which is precisely the expressiveness pressure doc 12 says to
 * refuse. Reuse belongs on rung 4 — a plugin — not in the owner's spec.
 *
 * Rules 1, 2 and 4 below are what make this a *profile* rather than "we use
 * YAML". A parser that accepts them has accepted a different language.
 */
import { isCollection, isNode, isPair, isScalar, visit, type Document } from "yaml";

import type { Diagnostic } from "./errors.js";

/** Parser options that carry rules 1 and 4. The rest need a walk. */
export const STRICT_PARSE_OPTIONS = {
  /** Rule 1 — YAML 1.2 core schema only. Kills 1.1 implicit typing: the Norway
   *  problem (`no` → `false`), version strings becoming floats, sexagesimals. */
  version: "1.2" as const,
  schema: "core" as const,
  /** Rule 4 — duplicate keys are an error, not last-wins. */
  uniqueKeys: true,
  /** Rule 2, half of it — merge keys (`<<`) are not resolved. */
  merge: false,
  keepSourceTokens: true,
};

/**
 * Rules 2 and 3, which the parser has no option for: anchors, aliases and
 * explicit tags all parse fine and must be rejected deliberately.
 */
/**
 * Rule 5, enforced on **input** as well as output.
 *
 * ADR 0006 states the printer quotes `{{` unconditionally because `{` opens a
 * flow mapping. The assumption behind that was that an unquoted template would
 * be a *parse error*. It is not — it is worse:
 *
 *     heading: {{ item.name }}      parses as   heading: { "item.name": null }
 *
 * A nested map, no error, and because block `attrs` are deliberately open
 * (the vocabulary is a registry, checked at registry lookup) the schema accepts
 * it too. The page then renders the literal text `[object Object]` or nothing at
 * all. That is the silent-wrong-output class this language exists to prevent, so
 * the parser has to reject it rather than the printer merely avoiding it.
 *
 * Scanned on the source text because at this point the mistake has already been
 * flattened into a map key — the structure no longer shows what was meant.
 */
export function checkUnquotedTemplates(source: string): Diagnostic[] {
  const issues: Diagnostic[] = [];
  source.split(/\r?\n/).forEach((raw, i) => {
    // Remove quoted spans first: a correctly quoted template must not match.
    const bare = raw.replace(/"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'/g, "");
    if (!bare.includes("{{")) return;
    // Only value positions and sequence items — a `{{` in a comment is harmless.
    const withoutComment = bare.split("#")[0] ?? "";
    if (!/(?::\s*|^\s*-\s+)\{\{/.test(withoutComment)) return;
    issues.push({
      path: "/",
      message: "a template in a value position must be quoted",
      line: i + 1,
      col: raw.indexOf("{{") + 1,
      hint:
        'write `heading: "{{ item.name }}"`. Unquoted, `{` opens a YAML flow mapping ' +
        "and the template silently becomes a nested map instead of text.",
    });
  });
  return issues;
}

export function checkProfile(
  doc: Document,
  locate: (offset?: number) => { line?: number; col?: number },
): Diagnostic[] {
  const issues: Diagnostic[] = [];
  const at = (node: unknown) => locate(isNode(node) ? node.range?.[0] : undefined);

  visit(doc, {
    Alias(_key, node) {
      issues.push({
        path: "/",
        message: `aliases (\`*${node.source}\`) are not allowed`,
        ...at(node),
        hint:
          "anchors and aliases are how a config language grows variables and inheritance. " +
          "Repeat the value, or move the reuse into a plugin.",
      });
    },
    Node(_key, node) {
      if (isNode(node) && node.anchor) {
        issues.push({
          path: "/",
          message: `anchors (\`&${node.anchor}\`) are not allowed`,
          ...at(node),
          hint: "remove the anchor and write the value where it is used.",
        });
      }
      // An explicit tag. The core schema's own resolved tags are not set here,
      // so anything present is author-written (`!!str`, `!Custom`).
      if ((isScalar(node) || isCollection(node)) && node.tag) {
        issues.push({
          path: "/",
          message: `tags (\`${node.tag}\`) are not allowed`,
          ...at(node),
          hint: "the schema decides types; a tag cannot change what a field means.",
        });
      }
    },
    Pair(_key, pair) {
      if (isPair(pair) && isScalar(pair.key) && pair.key.value === "<<") {
        issues.push({
          path: "/",
          message: "merge keys (`<<`) are not allowed",
          ...at(pair.key),
          hint: "inheritance is not part of this language. Write the fields out.",
        });
      }
    },
  });

  return issues;
}
