/**
 * The schema.
 *
 * Three decisions from the dossier are load-bearing here and each is marked at
 * the table it shapes: `org_id` + `site_id` on everything (ADR 0002 seam 1,
 * ADR 0008), `jsonb` for user-defined fields rather than EAV (doc 03 §2), and
 * `spec_patches` carrying an inverse for every change (doc 03 — "the spine; it
 * is not deferrable").
 */
import type { PatchOp, SiteSpec } from "@forinda-cms/spec";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  integer,
  bigserial,
} from "drizzle-orm/pg-core";

/**
 * Organizations (ADR 0008).
 *
 * A personal account is an organization of one, created on signup and never
 * labelled as such until a second member or site exists. A single-site
 * self-hosted install has exactly one row here and never shows the word.
 */
export const organizations = pgTable("organizations", {
  id: text().primaryKey(),
  name: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/** A site belongs to exactly one organization (ADR 0010). Ownership moves by transfer. */
export const sites = pgTable(
  "sites",
  {
    id: text().primaryKey(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    slug: text().notNull(),
    name: text().notNull(),
    domain: text(),
    /**
     * Internal, not the plugin API integer (ADR 0003/0012). A bump here is a
     * data migration; an `api` bump is an ecosystem event.
     */
    specVersion: integer().notNull().default(1),
    /** The site's wall-clock timezone. The gap `schedule` currently has (ADR 0014). */
    timezone: text().notNull().default("UTC"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sites_org_slug").on(t.orgId, t.slug), index("sites_domain").on(t.domain)],
);

/**
 * The current spec, one row per site.
 *
 * Stored whole rather than decomposed into tables. The decomposition that
 * matters is the *file* layout (ADR 0006), which is derived; splitting the
 * document across relational tables would buy queryability nobody needs and
 * cost the atomic read every render performs.
 */
export const siteSpecs = pgTable("site_specs", {
  siteId: text()
    .primaryKey()
    .references(() => sites.id, { onDelete: "cascade" }),
  orgId: text().notNull(),
  document: jsonb().$type<SiteSpec>().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * Every change, with its inverse. The spine.
 *
 * Doc 13's argument that review can move to a non-developer rests on a wrong
 * "yes" being cheap to reverse, and that is only true because the inverse is
 * recorded at the time the change is made rather than reconstructed later.
 * `inverse` is `notNull` for exactly that reason — a patch without one is not a
 * patch this system will accept.
 *
 * `seq` is per-site and monotonic, so undo is "apply the inverse of the highest
 * seq" and history reads in order without a timestamp tiebreak.
 */
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
     * Who made the change. Kept as a recorded name rather than a foreign key:
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
    appliedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Set when this patch has been undone, so history stays append-only. */
    revertedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("spec_patches_site_seq").on(t.siteId, t.seq),
    index("spec_patches_site_applied").on(t.siteId, t.appliedAt),
  ],
);

/**
 * Content entries.
 *
 * `data` is `jsonb` rather than EAV — doc 03 §2 settled that on the research:
 * EAV turns a two-condition filter into self-joins per condition and inflates
 * row metadata per attribute. Fields the spec marks filterable get generated
 * columns and real indexes, emitted by the migration planner; the GIN index
 * below covers everything else in the meantime.
 *
 * The cost is that Postgres enforces no types inside `jsonb`, so validation is
 * application-side against `packages/spec` — which every write already goes
 * through.
 */
export const entries = pgTable(
  "entries",
  {
    id: text().primaryKey(),
    siteId: text()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    orgId: text().notNull(),
    typeKey: text().notNull(),
    slug: text(),
    data: jsonb().$type<Record<string, unknown>>().notNull(),
    status: text().notNull().default("draft"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("entries_site_type_slug").on(t.siteId, t.typeKey, t.slug),
    index("entries_site_type").on(t.siteId, t.typeKey),
    index("entries_data_gin").using("gin", t.data),
    index("entries_site_type_status").on(t.siteId, t.typeKey, t.status),
  ],
);

/** Assets are content-addressed, so a copy is a row and not bytes (ADR 0010). */
export const assets = pgTable(
  "assets",
  {
    id: text().primaryKey(),
    orgId: text().notNull(),
    /** Null means org-scoped and shared across the org's sites (ADR 0010). */
    siteId: text().references(() => sites.id, { onDelete: "cascade" }),
    blobHash: text().notNull(),
    filename: text().notNull(),
    contentType: text().notNull(),
    bytes: integer().notNull(),
    alt: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assets_org").on(t.orgId), index("assets_blob").on(t.blobHash)],
);

/**
 * Row types, inferred rather than written.
 *
 * The pattern from `enaton`: every table exports its select and insert shapes,
 * so nothing downstream has to cast. Combined with `$type<>()` on the `jsonb`
 * columns above, a repository method can return `Promise<SpecPatchRow>` and a
 * caller can read `patch.inverse[0].value` with the compiler checking it —
 * which is what the first version of this package spent `as unknown as` on.
 */
export type OrganizationRow = typeof organizations.$inferSelect;
export type NewOrganizationRow = typeof organizations.$inferInsert;

export type SiteRow = typeof sites.$inferSelect;
export type NewSiteRow = typeof sites.$inferInsert;

export type SiteSpecRow = typeof siteSpecs.$inferSelect;
export type NewSiteSpecRow = typeof siteSpecs.$inferInsert;

export type SpecPatchRow = typeof specPatches.$inferSelect;
export type NewSpecPatchRow = typeof specPatches.$inferInsert;

export type EntryRow = typeof entries.$inferSelect;
export type NewEntryRow = typeof entries.$inferInsert;

export type AssetRow = typeof assets.$inferSelect;
export type NewAssetRow = typeof assets.$inferInsert;
