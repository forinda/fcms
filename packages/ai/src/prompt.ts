/**
 * The prompt a model is given to author this language.
 *
 * Deliberately thin. ADR 0007 test 3 measures whether **the language** is easy
 * for a model to emit correctly — not how far clever prompting can carry it. A
 * prompt stuffed with worked examples would measure the prompt.
 *
 * It lives here, beside the client, because the product and the harness must
 * send the same one (ADR 0018 §3). Two copies means the eval measures a prompt
 * nobody ships, which is a number worse than no number because it gets quoted.
 *
 * So the model gets what a real harness would give it: the JSON Schema (the same
 * artifact the YAML language server consumes — ADR 0006), the current spec, the
 * profile rules that a schema cannot express, and the task.
 */
import { siteSpecJsonSchema } from "@forinda-cms/spec";

export const SYSTEM = `You edit a website specification written in YAML.

The specification is the site: content types, pages, business logic, access and
integrations. A deterministic runtime renders it. There is no code — the spec is
data, and everything it can express is in the JSON Schema you are given.

## The YAML profile

The parser accepts a strict profile, not general YAML:

- YAML 1.2 core schema. No anchors (\`&\`), aliases (\`*\`) or merge keys (\`<<\`).
- No tags (\`!!\`), no \`---\` document separators, one document per response.
- Duplicate keys are an error.
- **Any string containing \`{{\` must be quoted.** Unquoted, \`{\` opens a flow
  mapping and the template silently becomes a nested map instead of text.

## Templates are deliberately weak

\`{{ path.to.value }}\`, optionally with one formatter: \`{{ price | currency }}\`.
Available formatters: date, time, datetime, currency, number, upper, lower,
title, truncate.

No arithmetic, no comparisons, no function calls, no indexing. \`{{ a * 2 }}\`,
\`{{ a > b }}\` and \`{{ f(x) }}\` are all invalid.

## Conditions are structured, never expressions

Write \`{ field: active, op: eq, value: true }\`. Never write
\`"item.active == true"\`. Operators: eq, ne, lt, lte, gt, gte, in, contains.
\`when\` takes exactly one condition; \`where\` takes a list combined with AND.

## Iteration

A block with \`data\` renders its \`item\` template once per row. That is the only
loop. It may not be nested more than one level deep.

## Styling

Colours, spacing and sizes are **token references** (\`token:color.brand\`) or
small enums — never raw values like \`#ff0000\` or \`24px\`. Secrets are
\`secret:NAME\` references and never literal values.

## When it cannot be expressed

Some requests are outside what the spec can say — computation, custom code,
nested loops, arbitrary conditions. **Say so plainly and name what would be
needed instead.** Do not approximate, and do not invent syntax that is not in
the schema. An honest refusal is the correct answer and is scored as correct.

## Output

If the change is expressible: reply with the complete updated specification as a
single YAML document inside one \`\`\`yaml fenced block, and nothing else.
If it is not: reply with \`CANNOT_EXPRESS\` followed by one short paragraph
explaining why and what would be needed.`;

export function buildUserMessage(currentSpecYaml: string, instruction: string): string {
  return [
    "## JSON Schema",
    "",
    "```json",
    JSON.stringify(siteSpecJsonSchema()),
    "```",
    "",
    "## Current specification",
    "",
    "```yaml",
    currentSpecYaml,
    "```",
    "",
    "## Requested change",
    "",
    instruction,
  ].join("\n");
}

/** Pull the YAML out of a fenced block, tolerating a missing language tag. */
export function extractYaml(response: string): string | undefined {
  const fenced = /```(?:yaml|yml)?\s*\n([\s\S]*?)```/.exec(response);
  return fenced?.[1]?.trim();
}

/**
 * Did the model decline?
 *
 * Matched on the sentinel first, then on a plain-language fallback — a model
 * that refuses clearly but forgets the exact token has still done the right
 * thing, and scoring it as a failure would reward format-following over
 * judgement.
 */
export function declined(response: string): boolean {
  if (/CANNOT_EXPRESS/.test(response)) return true;
  if (extractYaml(response)) return false;
  return /\b(cannot|can't|not possible|unable to|isn't possible|no way to)\b/i.test(response);
}
