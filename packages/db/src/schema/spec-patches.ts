/**
 * Every change, with its inverse. The spine (doc 03).
 *
 * Doc 13's argument that review can move to a non-developer rests on a wrong
 * "yes" being cheap to reverse, and that only holds because the inverse is
 * recorded at the time rather than reconstructed later. `inverse` is `notNull`
 * for exactly that reason — a patch without one is not a patch this system
 * accepts.
 *
 * `seq` is per-site and monotonic, so undo is "apply the inverse of the highest
 * seq" and history reads in order without a timestamp tiebreak.
 */
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { PatchOp } from "@forinda-cms/spec";

import { createdAt } from "./_shared.js";
import { sites } from "./sites.js";

export const specPatches = pgTable(
  "spec_patches",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    siteId: text()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    orgId: text().notNull(),
    seq: integer().notNull(),
    /**
     * Who made the change, as a recorded name rather than a foreign key:
     * ADR 0010 requires history to survive a site transfer without leaking the
     * source org's member directory.
     */
    actor: text().notNull(),
    /** Which surface produced it — chat, canvas, cli, mcp — and which harness. */
    source: text().notNull(),
    harness: text(),
    ops: jsonb().$type<PatchOp[]>().notNull(),
    inverse: jsonb().$type<PatchOp[]>().notNull(),
    classification: text().$type<"additive" | "destructive">().notNull(),
    /** One sentence a non-developer can verify (doc 13). */
    summary: text().notNull(),
    appliedAt: createdAt(),
    /** Set when undone, so history stays append-only rather than shrinking. */
    revertedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("spec_patches_site_seq").on(t.siteId, t.seq),
    index("spec_patches_site_applied").on(t.siteId, t.appliedAt),
  ],
);

export type SpecPatchRow = typeof specPatches.$inferSelect;
export type NewSpecPatchRow = typeof specPatches.$inferInsert;
