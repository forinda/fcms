/**
 * The condition triple — the single most important shape in this package.
 *
 * ADR 0009 turns on one distinction: a **structured** condition round-trips and
 * reads as a sentence; an **expression string** is code hiding in a value.
 *
 *     where: [{ field: active, op: eq, value: true }]     ← data
 *     where: "item.price > 100 && item.active"            ← code
 *
 * Both express the same filter. Only the first is inspectable, diffable,
 * schema-validatable, and safely proposable by a model. So the triple is the
 * only conditional form in the spec, used by both `when` (ADR 0009 §2) and
 * `where` (§1).
 *
 * The pressure to accept the second form will be constant. Accepting it ends
 * round-tripping and therefore the projection model.
 */
import { z } from "zod";

import { FieldName, Scalar } from "./primitives.js";

/** Fixed set. Adding one is a deliberate vocabulary decision, not a convenience. */
export const OPERATORS = [
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
  "in",
  "contains",
  /**
   * Has a value at all, or has none.
   *
   * `{ op: ne, value: "" }` is **true** for a field that is null, so a page
   * hiding an image behind one rendered `<img src="">` for every row without a
   * photo. The workaround was a string test standing in for a question the
   * vocabulary could not ask — which is the definition of a missing operator.
   *
   * Neither takes a value; the schema below says so rather than ignoring one.
   */
  "exists",
  "empty",
] as const;
export const Operator = z.enum(OPERATORS);
export type Operator = (typeof OPERATORS)[number];

/** A dotted path into the current scope: `item.price`, `flow.service.deposit`, `site.locale`. */
export const FieldPath = z
  .string()
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/, "a dotted property path");

/**
 * A value the visitor supplies, named rather than interpolated.
 *
 * `{ param: city }` and not `{{ query.city }}`: a template string inside a
 * comparison is an expression language arriving through the back door, and the
 * whole argument above is that a condition must stay data (ADR 0019 §1).
 *
 * Absent parameter, no condition — a search page has to work before anything is
 * typed. A `default` opts out of that where the filter is structural.
 */
export const ParamValue = z
  .object({
    param: z.string().regex(/^[a-z][a-z0-9_]*$/, "a lowercase parameter name"),
    default: Scalar.optional(),
  })
  .strict();

export type ParamValue = z.infer<typeof ParamValue>;

/**
 * A field of the entry the page is *for* (ADR 0014's collection pages).
 *
 * A detail page is one row and the lists on it are about that row — the rooms
 * of this property, the reviews of this property. Without this there is no way
 * to say so: a condition may name a field of the row being filtered or a
 * request parameter, and the page's own entry is neither. The lists on every
 * detail page therefore showed the whole site, which is the sort of bug that
 * looks like a design decision until somebody has two properties.
 *
 * Still data, and still checked: the page must be a collection page and the
 * field must exist on the type it collects, or the spec does not validate.
 */
export const EntryValue = z.object({ entry: FieldName }).strict();

export type EntryValue = z.infer<typeof EntryValue>;

export const Condition = z
  .object({
    field: FieldPath,
    op: Operator,
    value: z.union([Scalar, z.array(Scalar), ParamValue, EntryValue]).optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    // A parameter's arity is unknown until the request arrives, and an entry's
    // is unknown until the page has one, so the check below cannot apply to
    // either.
    if (typeof c.value === "object" && c.value !== null && "param" in c.value) return;
    if (typeof c.value === "object" && c.value !== null && "entry" in c.value) return;

    // `exists` and `empty` ask about presence, so a value is not wrong so much
    // as meaningless — and a meaningless value in a spec is a misunderstanding
    // worth reporting.
    if (c.op === "exists" || c.op === "empty") {
      if (c.value !== undefined && c.value !== null) {
        ctx.addIssue({ code: "custom", message: `\`${c.op}\` takes no value` });
      }
      return;
    }

    // `in` takes a list; everything else takes a scalar. Catching this here beats
    // a renderer silently matching nothing.
    const isList = Array.isArray(c.value);
    if (c.op === "in" && !isList) {
      ctx.addIssue({ code: "custom", message: "`in` needs a list of values" });
    }
    if (c.op !== "in" && isList) {
      ctx.addIssue({ code: "custom", message: `\`${c.op}\` takes a single value, not a list` });
    }
  });

export type Condition = z.infer<typeof Condition>;

/**
 * `when` is **one** condition per block, never a list.
 *
 * To express "A and B", nest blocks. That restriction is deliberate: it keeps
 * `when` readable in a diff and stops it growing into an expression grammar by
 * the usual route — first a list, then nesting, then operators between groups.
 */
export const When = Condition;
