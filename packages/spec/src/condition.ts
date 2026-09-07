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
 * round-tripping and therefore the projection model (research/11 §1).
 */
import { z } from "zod";

import { Scalar } from "./primitives.js";

/** Fixed set. Adding one is a deliberate vocabulary decision, not a convenience. */
export const OPERATORS = ["eq", "ne", "lt", "lte", "gt", "gte", "in", "contains"] as const;
export const Operator = z.enum(OPERATORS);
export type Operator = (typeof OPERATORS)[number];

/** A dotted path into the current scope: `item.price`, `flow.service.deposit`, `site.locale`. */
export const FieldPath = z
  .string()
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/, "a dotted property path");

export const Condition = z
  .object({
    field: FieldPath,
    op: Operator,
    value: z.union([Scalar, z.array(Scalar)]),
  })
  .strict()
  .superRefine((c, ctx) => {
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
