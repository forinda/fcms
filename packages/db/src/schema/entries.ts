/**
 * Content entries.
 *
 * `data` is `jsonb` rather than EAV — doc 03 §2 settled that on the research:
 * EAV turns a two-condition filter into self-joins per condition and inflates
 * row metadata per attribute.
 *
 * Fields the spec marks filterable get partial expression indexes, emitted by
 * the migration planner (`planner.ts`, which deviates from doc 03's "generated
 * columns" and says why). The GIN index below covers everything else.
 *
 * The cost of `jsonb` is that Postgres enforces no types inside it, so
 * validation is application-side against `packages/spec` — which every write
 * already goes through.
 */
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { createdAt, pk } from "./_shared.js";
import { sites } from "./sites.js";

export const entries = pgTable(
  "entries",
  {
    /**
     * A ULID, not the slug.
     *
     * The seed used to build `"service:cut"`, which reads well and breaks the
     * moment a slug changes — every reference would need rewriting. The unique
     * index on (site, type, slug) already enforces the slug's uniqueness; the id
     * only has to be stable.
     */
    id: pk(),
    siteId: text()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    orgId: text().notNull(),
    typeKey: text().notNull(),
    slug: text(),
    data: jsonb().$type<Record<string, unknown>>().notNull(),
    status: text().notNull().default("draft"),
    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("entries_site_type_slug").on(t.siteId, t.typeKey, t.slug),
    index("entries_site_type").on(t.siteId, t.typeKey),
    index("entries_data_gin").using("gin", t.data),
    index("entries_site_type_status").on(t.siteId, t.typeKey, t.status),
  ],
);

export type EntryRow = typeof entries.$inferSelect;
export type NewEntryRow = typeof entries.$inferInsert;
