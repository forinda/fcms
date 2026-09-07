/**
 * Sites.
 *
 * A site belongs to exactly one organization (ADR 0010) — no shared ownership,
 * no site in two orgs. Ownership moves by an explicit transfer, never by
 * membership, because shared ownership leaves permission checks, billing and
 * deletion without an authority.
 */
import { index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { configuredId, createdAt } from "./_shared.js";
import { organizations } from "./organizations.js";

export const sites = pgTable(
  "sites",
  {
    // Supplied by `SITE_ID`, not generated — see `configuredId`.
    id: configuredId().primaryKey(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    slug: text().notNull(),
    name: text().notNull(),
    domain: text(),
    /**
     * Internal, and not the plugin API integer (ADR 0003/0012). A bump here is
     * a data migration; an `api` bump is an ecosystem event.
     */
    specVersion: integer().notNull().default(1),
    /**
     * The site's wall-clock timezone.
     *
     * The gap ADR 0014 recorded for `schedule`: availability is computed against
     * server-local time today, which is wrong the moment a business is hosted
     * somewhere it is not. This column is where the fix reads from.
     */
    timezone: text().notNull().default("UTC"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sites_org_slug").on(t.orgId, t.slug), index("sites_domain").on(t.domain)],
);

export type SiteRow = typeof sites.$inferSelect;
export type NewSiteRow = typeof sites.$inferInsert;
