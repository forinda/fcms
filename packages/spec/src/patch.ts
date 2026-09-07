/**
 * Patches — the spine (doc 03).
 *
 * Every authoring surface reduces to one of these: chat, canvas, the YAML
 * language, the CLI, an external harness (research/11). Nothing below this line
 * changes when a surface is added, which is the test a new surface has to pass.
 *
 * Two properties matter more than the shape:
 *
 * 1. **Every patch stores its inverse.** Undo is a table lookup, not a git
 *    operation. That is what lowers the cost of being wrong enough to hand
 *    review to a non-developer (doc 13).
 * 2. **Classification gates the dangerous half.** Additive applies; destructive
 *    needs a human yes. This is also what neutralises the wholesale-rewrite
 *    failure — anything a model forgot to mention surfaces as a deletion.
 */
import { z } from "zod";

/** A JSON Pointer-ish path into the spec document, e.g. `/pages/home/blocks/2`. */
export const SpecPath = z.string().regex(/^\/[^\s]*$/);

export const PatchOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), path: SpecPath, value: z.unknown() }).strict(),
  z.object({ op: z.literal("insert"), path: SpecPath, value: z.unknown() }).strict(),
  z.object({ op: z.literal("remove"), path: SpecPath }).strict(),
  z.object({ op: z.literal("move"), path: SpecPath, to: SpecPath }).strict(),
]);
export type PatchOp = z.infer<typeof PatchOp>;

/**
 * Additive widens; destructive can lose data or break a reference.
 *
 * The same classification governs migrations (doc 03), media scope changes
 * (ADR 0010 — promote is additive, demote is destructive) and spec edits. One
 * rule, three places, which is why it is defined here rather than in each.
 */
export const Classification = z.enum(["additive", "destructive"]);
export type Classification = z.infer<typeof Classification>;

export const Patch = z
  .object({
    ops: z.array(PatchOp).min(1),
    /** Applying this returns the document to its prior state. Never optional. */
    inverse: z.array(PatchOp).min(1),
    classification: Classification,
    /** One sentence a non-developer can verify — doc 13's whole argument. */
    summary: z.string().min(1).max(500),
  })
  .strict();

export type Patch = z.infer<typeof Patch>;

/** `remove` and `move` can lose or relocate content; `set`/`insert` cannot. */
export function classify(ops: readonly PatchOp[]): Classification {
  return ops.some((o) => o.op === "remove" || o.op === "move") ? "destructive" : "additive";
}
