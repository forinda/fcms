/**
 * Media.
 *
 * Content-addressed (ADR 0010), so a copy is a row pointing at an existing blob
 * rather than bytes moved — which is what makes a site transfer fast in the
 * common case and slow only when the storage backend genuinely differs.
 *
 * A null `siteId` means org-scoped and shared across the org's sites. That is
 * the opt-in half of ADR 0010's asymmetry: promoting widens access and is
 * additive; demoting breaks any other site referencing the asset.
 */
import { index, integer, pgTable, text } from "drizzle-orm/pg-core";

import { createdAt, pk } from "./_shared.js";
import { sites } from "./sites.js";

export const assets = pgTable(
  "assets",
  {
    // Stable forever: ADR 0010 makes a transfer change rows, never an
    // `asset:` reference inside a spec.
    id: pk(),
    orgId: text().notNull(),
    /** Null means org-scoped, shared across the org's sites (ADR 0010). */
    siteId: text().references(() => sites.id, { onDelete: "cascade" }),
    blobHash: text().notNull(),
    filename: text().notNull(),
    contentType: text().notNull(),
    bytes: integer().notNull(),
    alt: text(),
    createdAt: createdAt(),
  },
  (t) => [index("assets_org").on(t.orgId), index("assets_blob").on(t.blobHash)],
);

export type AssetRow = typeof assets.$inferSelect;
export type NewAssetRow = typeof assets.$inferInsert;
