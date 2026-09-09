/**
 * Shared scalars: keys, references, and the template language.
 *
 * References are **prefixed strings** rather than objects (ADR 0006). That is
 * deliberate: they round-trip through YAML with no machinery, stay readable in a
 * diff, and validation is this schema's job rather than the parser's.
 */
import { z } from "zod";

/**
 * An identifier the author chooses: content type keys, field names, page keys,
 * workflow keys. Lowercase kebab so it is safe in a URL, a filename and a YAML
 * key at once — ADR 0006 derives the file layout from these.
 */
export const Key = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, "lowercase kebab-case, starting with a letter");

/**
 * The stored value of a `select` option.
 *
 * A `Key` everywhere else, but a select's options are not identifiers the rest
 * of the spec refers to — nothing points at them, they are the value a row
 * holds and a query parameter carries. Requiring a leading letter made a star
 * rating impossible to express: `"4"` is not a key, and the alternative
 * (`four-stars`) is a label pretending to be data and does not sort.
 *
 * Still URL- and filename-safe, which is the property that mattered.
 */
export const OptionValue = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase letters, digits and hyphens");

/**
 * A field name — **not** a `Key`.
 *
 * Keys become filenames and URL segments, so kebab-case is right for them. Field
 * names become *property paths*: `{{ entry.customerName }}`, `sort.field`,
 * `where[].field`. A kebab name cannot appear in one — `entry.customer-name`
 * reads as a subtraction — so field names are camelCase and must match the path
 * grammar in `condition.ts`.
 *
 * Found by hand-authoring the first real spec (ADR 0007 test 1), which is the
 * kind of thing only writing a real business's spec surfaces.
 */
export const FieldName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-zA-Z0-9]*$/, "camelCase, starting with a lowercase letter");

/** A URL path. Always absolute, no trailing slash (except the root itself). */
export const Path = z
  .string()
  .regex(/^\/([a-z0-9\-/]*[a-z0-9])?$/, "absolute lowercase path, no trailing slash")
  .refine((p) => !p.includes("//"), "no empty path segments");

/**
 * The prefixed reference forms. Each is a plain scalar in YAML.
 *
 * `ref:`    — an entry, as `<content-type>/<slug>`
 * `asset:`  — a media asset by its stable id (ADR 0010: the id is identity, so a
 *             transfer never rewrites one of these)
 * `token:`  — a theme token, as a dotted path (`color.brand`, `space.lg`)
 * `secret:` — an integration credential **by name only**. ADR 0001 forbids a
 *             secret value ever appearing in the spec, and this is the form that
 *             makes that enforceable rather than a convention.
 */
export const EntryRef = z.string().regex(/^ref:[a-z][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/);
export const AssetRef = z.string().regex(/^asset:[0-9a-f]{8,32}$/);
export const TokenRef = z.string().regex(/^token:[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/);
export const SecretRef = z.string().regex(/^secret:[A-Z][A-Z0-9_]*$/);

export const AnyRef = z.union([EntryRef, AssetRef, TokenRef, SecretRef]);

/**
 * The template language, and the reason it is parsed here rather than at render
 * time.
 *
 * ADR 0001: *"Templating is a language, and it is deliberately weak."* Property
 * access plus at most one formatter from a fixed list. No calls, no arithmetic,
 * no dynamic lookup — the moment it can compute, the spec contains code and the
 * ceiling has been lost by increments rather than by decision.
 *
 * Validating it in the schema means a bad template fails `fcms validate`, not a
 * page render in front of a customer.
 */
export const FORMATTERS = [
  "date",
  "time",
  "datetime",
  "currency",
  "number",
  "upper",
  "lower",
  "title",
  "truncate",
  /**
   * The word that goes with a number.
   *
   * `{{ n | plural: property, properties }}`. `results-count` has had `one` and
   * `many` since it existed, so the idea was already in the vocabulary — it was
   * simply not available to a template, and "1 properties" appeared on every
   * city with one property in it.
   *
   * The only formatter that takes arguments, and it takes exactly two. That is
   * a deliberate ceiling: an argument list is the first half of an expression
   * language, and English plurals are the one place a lookup genuinely cannot
   * answer.
   */
  "plural",
] as const;

export type Formatter = (typeof FORMATTERS)[number];

/**
 * `{{ a.b.c }}`, `{{ a.b | currency }}`, or `{{ n | plural: room, rooms }}`.
 *
 * Whitespace is free-form. The argument list is one capture and belongs to
 * `plural` alone — anything else that grows arguments should be a field with a
 * declared formula instead, which is where computation lives.
 */
const EXPRESSION =
  /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*(?:\|\s*([a-z]+)\s*(?::\s*([^}]*?)\s*)?)?\}\}/g;

export interface TemplateExpression {
  /** The dotted path, e.g. `item.name` or `flow.service.deposit`. */
  readonly path: string;
  readonly formatter?: Formatter;
  /** `plural`'s two words, in order. Empty for every other formatter. */
  readonly args?: readonly string[];
  /** The whole `{{ … }}`, for error messages. */
  readonly raw: string;
}

/** Every `{{ … }}` in a string, in order. Malformed braces are simply not matches. */
export function parseTemplate(input: string): TemplateExpression[] {
  const out: TemplateExpression[] = [];
  for (const m of input.matchAll(EXPRESSION)) {
    const args = m[3]
      ?.split(",")
      .map((word) => word.trim())
      .filter(Boolean);
    out.push({
      path: m[1]!,
      ...(m[2] ? { formatter: m[2] as Formatter } : {}),
      ...(args && args.length > 0 ? { args } : {}),
      raw: m[0]!,
    });
  }
  return out;
}

/**
 * Anything that *looks* like an interpolation but did not parse as one.
 *
 * This is the check that matters. A silently-ignored `{{ price * 2 }}` renders
 * as literal braces on a live page, which is the worst outcome: no error, wrong
 * output. Catching it here turns a production embarrassment into a validation
 * failure.
 */
function malformed(input: string): string[] {
  const candidates = input.match(/\{\{[^}]*\}\}/g) ?? [];
  const valid = new Set(parseTemplate(input).map((e) => e.raw));
  return candidates.filter((c) => !valid.has(c));
}

/** A string that may interpolate values. Validated, not merely typed. */
export const TemplateString = z.string().superRefine((value, ctx) => {
  for (const bad of malformed(value)) {
    ctx.addIssue({
      code: "custom",
      message:
        `${bad} is not a valid expression. Templates allow property access and one ` +
        `formatter (${FORMATTERS.join(", ")}) — no arithmetic, calls or comparisons.`,
    });
  }
  for (const expr of parseTemplate(value)) {
    if (expr.formatter && !FORMATTERS.includes(expr.formatter)) {
      ctx.addIssue({
        code: "custom",
        message: `unknown formatter "${expr.formatter}" in ${expr.raw}`,
      });
    }
  }
});

/** A JSON scalar. The leaf of any `value` position in the spec. */
export const Scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type Scalar = z.infer<typeof Scalar>;

/** Human-facing label. Free text, bounded so it stays a label. */
export const Label = z.string().min(1).max(200);

/**
 * An author's "why is this here" note (ADR 0014, decision 6).
 *
 * Comments do not survive the canonical printer — ADR 0006 took that bargain
 * knowingly — so a note has to be *data* to round-trip. Writing the first real
 * spec made the cost concrete: `fmt` would have deleted every explanation in it.
 *
 * The people most likely to annotate a spec are doc 12's implementer channel, an
 * agency keeping client specs in git, and `pull` silently deleting their notes
 * on every sync loses a channel rather than annoying it.
 */
export const Note = z.string().max(2000).optional();
