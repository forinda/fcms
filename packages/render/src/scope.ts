/**
 * Template resolution — the weak language, evaluated.
 *
 * ADR 0001 keeps this deliberately weak: property access plus one formatter.
 * The parser in `@forinda-cms/spec` already rejects anything more, so this
 * evaluator can be total and simple — it never needs to handle an expression,
 * because an expression cannot reach it.
 *
 * Scopes are added by the constructs that introduce them: `item.*` inside a
 * `data` block, `flow.<step>.*` inside a flow (ADR 0009).
 */
import { parseTemplate, type Formatter } from "@forinda-cms/spec";

export type Scope = Record<string, unknown>;

function lookup(scope: Scope, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, scope);
}

/**
 * Formatting locale and currency.
 *
 * Defaults are Kenya-first (doc 14), but they are a *parameter* rather than a
 * constant — a formatter that can only render one currency is a bug, not a
 * simplification. The spec has no locale field yet; when it gains one in Phase
 * 0b this reads from there instead of from the caller.
 */
export interface FormatLocale {
  readonly locale: string;
  readonly currency: string;
}

export const DEFAULT_LOCALE: FormatLocale = { locale: "en-KE", currency: "KES" };

function format(
  value: unknown,
  formatter: Formatter | undefined,
  fmt: FormatLocale,
  args: readonly string[] = [],
): string {
  const { locale, currency } = fmt;
  if (value === null || value === undefined) return "";
  switch (formatter) {
    case undefined:
      return String(value);
    case "upper":
      return String(value).toUpperCase();
    case "lower":
      return String(value).toLowerCase();
    case "title":
      return String(value).replace(/\b\w/g, (c) => c.toUpperCase());
    case "truncate":
      return String(value).length > 120 ? `${String(value).slice(0, 117)}…` : String(value);
    case "number":
      return typeof value === "number"
        ? new Intl.NumberFormat(locale).format(value)
        : String(value);
    case "currency":
      return typeof value === "number"
        ? new Intl.NumberFormat(locale, { style: "currency", currency }).format(value)
        : String(value);
    case "date":
      return new Date(String(value)).toLocaleDateString(locale, { dateStyle: "medium" });
    case "time":
      return new Date(String(value)).toLocaleTimeString(locale, { timeStyle: "short" });
    case "datetime":
      return new Date(String(value)).toLocaleString(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    case "plural": {
      // The number itself is not printed: the template already has it, and a
      // formatter that printed it too would read "1 1 property".
      const [one = "", many = ""] = args;
      return Number(value) === 1 ? one : many;
    }
  }
}

/**
 * Substitute every `{{ … }}` in a string.
 *
 * Returns plain text, never HTML — escaping happens at the point of output in
 * `html.ts`, so a value containing `<script>` is inert wherever it lands. That
 * ordering matters: resolving to HTML here would make every block a potential
 * injection point.
 */
export function resolve(
  template: string,
  scope: Scope,
  fmt: FormatLocale = DEFAULT_LOCALE,
): string {
  let out = template;
  for (const expr of parseTemplate(template)) {
    out = out.replace(expr.raw, format(lookup(scope, expr.path), expr.formatter, fmt, expr.args));
  }
  return out;
}

/** Resolve every string in an attrs bag. Non-strings pass through untouched. */
export function resolveAttrs(
  attrs: Record<string, unknown> | undefined,
  scope: Scope,
  fmt: FormatLocale = DEFAULT_LOCALE,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs ?? {})) {
    out[key] = typeof value === "string" ? assetUrl(resolve(value, scope, fmt)) : value;
  }
  return out;
}

/**
 * `asset:<id>` becomes the URL that serves it.
 *
 * Rewritten here rather than looked up, because the id *is* the address: the
 * renderer stays a pure function of the spec and the rows, with no database
 * behind it, which is what lets `fcms dev` render a site from files alone
 * (ADR 0007's seam).
 *
 * A reference that is already a URL, or a path, is left alone — an author
 * pasting a link should not have it rewritten.
 */
function assetUrl(value: string): string {
  const match = /^asset:([0-9a-fA-F-]{6,64})$/.exec(value.trim());
  return match ? `/media/${match[1]}` : value;
}
