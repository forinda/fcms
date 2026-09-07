/**
 * Organizations.
 *
 * A personal account is an organization of one (ADR 0008), created on signup and
 * never labelled as such until a second member or site exists. A single-site
 * self-hosted install has exactly one row here and never shows the word.
 */
import { pgTable, text } from "drizzle-orm/pg-core";

import { configuredId, createdAt } from "./_shared.js";

export const organizations = pgTable("organizations", {
  // Supplied by `ORG_ID`, not generated — see `configuredId`.
  id: configuredId().primaryKey(),
  name: text().notNull(),
  createdAt: createdAt(),
});

export type OrganizationRow = typeof organizations.$inferSelect;
export type NewOrganizationRow = typeof organizations.$inferInsert;
