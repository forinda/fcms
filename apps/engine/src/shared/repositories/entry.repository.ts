/**
 * Content entries.
 *
 * `data` is typed at the column (`$type<Record<string, unknown>>`), so nothing
 * here casts. The values inside it are validated against the spec on write —
 * Postgres enforces no types inside `jsonb`, which doc 03 §2 accepted as the
 * cost of not using EAV.
 */
import { Inject, Repository, Scope as Lifetime } from "@forinda/kickjs";
import { sql, type Expression, type ExpressionBuilder, type SqlBool } from "@forinda/kickjs-db";
import { DRAFT_KEY, VISITOR_KEY, type Entry } from "@forinda-cms/render";

import type { EntryRow, Kdb, KdbSchema, Scope } from "@forinda-cms/db";

import { KDB } from "@/shared/db";
import { CURRENT_SCOPE } from "@/contributors/site.contributor";

export interface EntryPageQuery {
  /** Free text, matched against the slug and the fields the caller names. */
  readonly search?: string | undefined;
  readonly status?: "draft" | "published" | undefined;
  readonly sort?: "newest" | "oldest" | "updated" | "title" | undefined;
  /** Which fields the search looks inside, and which one `sort: "title"` uses. */
  readonly searchable?: readonly string[] | undefined;
  readonly titleField?: string | undefined;
  readonly limit: number;
  readonly offset: number;
}

export interface EntryPage {
  readonly rows: EntryRow[];
  /** Matching rows, not rows returned — what a pager needs. */
  readonly total: number;
}

/**
 * The filters, as SQL.
 *
 * Search is `ilike` over named fields rather than the whole document: casting
 * `data` to text would match key names, so searching for "name" would return
 * everything. ponytail: `ilike` cannot use the GIN index, which is fine into
 * the tens of thousands of rows and is where a trigram index goes when it isn't.
 */
function conditions(eb: ExpressionBuilder<KdbSchema, "entries">, query: EntryPageQuery) {
  const out: Expression<SqlBool>[] = [];
  if (query.status) out.push(eb("status", "=", query.status));

  const text = query.search?.trim();
  if (text) {
    // `%` and `_` are wildcards to `ilike`, and somebody will type one. A
    // backslash is `ilike`'s default escape character.
    const pattern = `%${text.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
    const fields = [...new Set([...(query.searchable ?? []), query.titleField ?? ""])].filter(
      Boolean,
    );
    out.push(
      eb.or([
        eb(sql<string>`coalesce(slug, '')`, "ilike", pattern),
        ...fields.map((name) => eb(sql<string>`coalesce(data ->> ${name}, '')`, "ilike", pattern)),
      ]),
    );
  }
  return out;
}

/**
 * Newest first by default.
 *
 * Any order at all is an improvement — the list had none, so two loads could
 * disagree — and newest-first is the one an owner wants: the booking that just
 * arrived is the row they came to see.
 */
function ordering(query: EntryPageQuery) {
  switch (query.sort) {
    case "oldest":
      return [sql`created_at asc`, sql`id asc`];
    case "updated":
      return [sql`updated_at desc`, sql`id desc`];
    case "title":
      return [sql`lower(coalesce(data ->> ${query.titleField ?? "title"}, '')) asc`];
    default:
      return [sql`created_at desc`, sql`id desc`];
  }
}

/** What a uuid looks like — an id from a URL must not reach a uuid column raw. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Repository({ scope: Lifetime.REQUEST })
export class EntryRepository {
  constructor(
    @Inject(KDB) private readonly db: Kdb,
    @Inject(CURRENT_SCOPE) private readonly scope: Scope,
  ) {}

  private readonly scoped = (eb: ExpressionBuilder<KdbSchema, "entries">) =>
    eb.and([eb("orgId", "=", this.scope.orgId), eb("siteId", "=", this.scope.siteId)]);

  async byId(id: string): Promise<EntryRow | null> {
    if (!UUID.test(id)) return null;
    const row = await this.db
      .selectFrom("entries")
      .selectAll()
      .where(this.scoped)
      .where("id", "=", id)
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  /**
   * One screenful of a type, filtered and ordered — the admin's list.
   *
   * `rowsOfType` returns everything in whatever order Postgres feels like,
   * which is fine for a fixture and wrong for a business: a salon writes a few
   * thousand bookings a year, the page renders all of them, and the order can
   * differ between two loads of the same screen. This is the query that screen
   * actually wants — a page of rows, a total, and a way to find one.
   */
  async pageOfType(typeKey: string, query: EntryPageQuery): Promise<EntryPage> {
    const where = (eb: ExpressionBuilder<KdbSchema, "entries">) =>
      eb.and([this.scoped(eb), eb("typeKey", "=", typeKey), ...conditions(eb, query)]);

    const [rows, counted] = await Promise.all([
      ordering(query)
        .reduce(
          (q, order) => q.orderBy(order),
          this.db.selectFrom("entries").selectAll().where(where),
        )
        .limit(query.limit)
        .offset(query.offset)
        .execute(),
      this.db
        .selectFrom("entries")
        .select(sql<number>`count(*)::int`.as("total"))
        .where(where)
        .executeTakeFirst(),
    ]);

    return { rows, total: counted?.total ?? 0 };
  }

  /** Every row of a type, drafts included — the admin's view. */
  async rowsOfType(typeKey: string): Promise<EntryRow[]> {
    return this.db
      .selectFrom("entries")
      .selectAll()
      .where(this.scoped)
      .where("typeKey", "=", typeKey)
      .execute();
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
      .selectFrom("entries")
      .selectAll()
      .where(this.scoped)
      .where("typeKey", "=", typeKey)
      .where("status", "=", "published")
      .execute();
  }

  /** Publish or unpublish one row, scoped so an id alone cannot reach another site. */
  async setStatus(id: string, status: "draft" | "published"): Promise<boolean> {
    const rows = await this.db
      .updateTable("entries")
      .set({ status, updatedAt: new Date() })
      .where(this.scoped)
      .where("id", "=", id)
      .returning("id")
      .execute();
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
            .selectFrom("entries")
            .selectAll()
            .where(this.scoped)
            .where("typeKey", "=", typeKey)
            .where("visitorId", "=", viewer)
            .where("status", "!=", "published")
            .execute()
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

  /** One row by its slug — how a `ref:type/slug` is followed. */
  async bySlug(slug: string): Promise<EntryRow | null> {
    const row = await this.db
      .selectFrom("entries")
      .selectAll()
      .where(this.scoped)
      .where("slug", "=", slug)
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  async countsByType(): Promise<Record<string, number>> {
    const rows = await this.db
      .selectFrom("entries")
      .select(["typeKey", sql<number>`count(*)::int`.as("count")])
      .where(this.scoped)
      .groupBy("typeKey")
      .execute();

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
      .selectFrom("entries")
      .select(["typeKey", sql<number>`count(*)::int`.as("count")])
      .where(this.scoped)
      .where("status", "=", "draft")
      .groupBy("typeKey")
      .execute();

    return Object.fromEntries(rows.map((r) => [r.typeKey, r.count]));
  }
}
