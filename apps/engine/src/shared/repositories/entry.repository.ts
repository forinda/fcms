/**
 * Content entries.
 *
 * `data` is typed at the column (`$type<Record<string, unknown>>`), so nothing
 * here casts. The values inside it are validated against the spec on write —
 * Postgres enforces no types inside `jsonb`, which doc 03 §2 accepted as the
 * cost of not using EAV.
 */
import { Inject, Repository, Scope as Lifetime } from "@forinda/kickjs";
import { and, eq, ne, sql } from "drizzle-orm";
import { DRAFT_KEY, VISITOR_KEY, type Entry } from "@forinda-cms/render";

import { entries, type EntryRow } from "@forinda-cms/db";
import type { Db, Scope } from "@forinda-cms/db";

import { DB } from "@/shared/db";
import { CURRENT_SCOPE } from "@/contributors/site.contributor";

/** What a uuid looks like — an id from a URL must not reach a uuid column raw. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Repository({ scope: Lifetime.REQUEST })
export class EntryRepository {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CURRENT_SCOPE) private readonly scope: Scope,
  ) {}

  private get scoped() {
    return and(eq(entries.orgId, this.scope.orgId), eq(entries.siteId, this.scope.siteId));
  }

  async byId(id: string): Promise<EntryRow | null> {
    if (!UUID.test(id)) return null;
    const [row] = await this.db
      .select()
      .from(entries)
      .where(and(this.scoped, eq(entries.id, id)))
      .limit(1);
    return row ?? null;
  }

  /** Every row of a type, drafts included — the admin's view. */
  async rowsOfType(typeKey: string): Promise<EntryRow[]> {
    return this.db
      .select()
      .from(entries)
      .where(and(this.scoped, eq(entries.typeKey, typeKey)));
  }

  /**
   * Published rows only — what the public site may see.
   *
   * The `status` column existed, was indexed, and was read by nothing: an entry
   * created in the admin is a draft, and every draft was being served to the
   * public. "Save it and finish it tomorrow" published it.
   */
  async publishedOfType(typeKey: string): Promise<EntryRow[]> {
    return this.db
      .select()
      .from(entries)
      .where(and(this.scoped, eq(entries.typeKey, typeKey), eq(entries.status, "published")));
  }

  /** Publish or unpublish one row, scoped so an id alone cannot reach another site. */
  async setStatus(id: string, status: "draft" | "published"): Promise<boolean> {
    const rows = await this.db
      .update(entries)
      .set({ status, updatedAt: new Date() })
      .where(and(this.scoped, eq(entries.id, id)))
      .returning({ id: entries.id });
    return rows.length > 0;
  }

  /**
   * Entries in the shape the renderer reads.
   *
   * `id` and `slug` are merged in from their columns rather than trusted to be
   * present in `data`, so a template can rely on them regardless of how the row
   * was written.
   */
  /**
   * Rows for the renderer.
   *
   * Published rows, plus — when a visitor is signed in — the ones that visitor
   * wrote, whatever their status (ADR 0027 §3). Each row carries who wrote it
   * and whether it is a draft, so the renderer can enforce the rule the
   * repository cannot see: an unpublished row is visible to its author, and
   * only through a query that asked for the author's own rows.
   */
  async allOfType(typeKey: string, viewer?: string | null): Promise<Entry[]> {
    const published = await this.publishedOfType(typeKey);
    const own =
      viewer && UUID.test(viewer)
        ? await this.db
            .select()
            .from(entries)
            .where(
              and(
                this.scoped,
                eq(entries.typeKey, typeKey),
                eq(entries.visitorId, viewer),
                ne(entries.status, "published"),
              ),
            )
        : [];

    return [...published, ...own].map((row) => ({
      ...row.data,
      id: row.id,
      slug: row.slug ?? undefined,
      [VISITOR_KEY]: row.visitorId ?? undefined,
      [DRAFT_KEY]: row.status !== "published",
    }));
  }

  /**
   * Every row of a type, published or not, for the availability generators.
   *
   * Marked as drafts so nothing renders them — what reads these is the
   * occupancy calculation, which cares that a room is taken rather than that
   * anybody has approved saying so.
   */
  async everyOfType(typeKey: string): Promise<Entry[]> {
    const rows = await this.rowsOfType(typeKey);
    return rows.map((row) => ({
      ...row.data,
      id: row.id,
      slug: row.slug ?? undefined,
      [VISITOR_KEY]: row.visitorId ?? undefined,
      [DRAFT_KEY]: row.status !== "published",
    }));
  }

  async countsByType(): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ typeKey: entries.typeKey, count: sql<number>`count(*)::int` })
      .from(entries)
      .where(this.scoped)
      .groupBy(entries.typeKey);

    return Object.fromEntries(rows.map((r) => [r.typeKey, r.count]));
  }

  /**
   * Drafts per type, for the admin.
   *
   * Shown beside the total because "12 services, 3 not published" is a fact an
   * owner acts on, and an unpublished entry is otherwise invisible until
   * somebody wonders why the page is short.
   */
  async draftCountsByType(): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ typeKey: entries.typeKey, count: sql<number>`count(*)::int` })
      .from(entries)
      .where(and(this.scoped, eq(entries.status, "draft")))
      .groupBy(entries.typeKey);

    return Object.fromEntries(rows.map((r) => [r.typeKey, r.count]));
  }
}
