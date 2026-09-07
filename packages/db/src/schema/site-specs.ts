/**
 * The current spec, one row per site.
 *
 * Stored whole rather than decomposed into tables. The decomposition that
 * matters is the *file* layout (ADR 0006), which is derived; splitting the
 * document across relational tables would buy queryability nobody needs and
 * cost the atomic read every render performs.
 *
 * `$type<SiteSpec>()` is a compile-time assertion about what we wrote, so
 * readers still parse — the type says what it should be, the parse says what it
 * is.
 */
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { SiteSpec } from "@forinda-cms/spec";

import { sites } from "./sites.js";

export const siteSpecs = pgTable("site_specs", {
  siteId: text()
    .primaryKey()
    .references(() => sites.id, { onDelete: "cascade" }),
  orgId: text().notNull(),
  document: jsonb().$type<SiteSpec>().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export type SiteSpecRow = typeof siteSpecs.$inferSelect;
export type NewSiteSpecRow = typeof siteSpecs.$inferInsert;
