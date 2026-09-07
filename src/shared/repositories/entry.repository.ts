/**
 * Content entries.
 *
 * `data` is typed at the column (`$type<Record<string, unknown>>`), so nothing
 * here casts. The values inside it are validated against the spec on write —
 * Postgres enforces no types inside `jsonb`, which doc 03 §2 accepted as the
 * cost of not using EAV.
 */
import { Inject, Repository, Scope as Lifetime } from "@forinda/kickjs";
import { and, eq, sql } from "drizzle-orm";
import type { Entry } from "@forinda-cms/render";

import { entries, type EntryRow } from "@forinda-cms/db";
import type { Db, Scope } from "@forinda-cms/db";

import { DB } from "@/shared/db";
import { CURRENT_SCOPE } from "@/contributors/site.contributor";

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
    const [row] = await this.db
      .select()
      .from(entries)
      .where(and(this.scoped, eq(entries.id, id)))
      .limit(1);
    return row ?? null;
  }

  async rowsOfType(typeKey: string): Promise<EntryRow[]> {
    return this.db
      .select()
      .from(entries)
      .where(and(this.scoped, eq(entries.typeKey, typeKey)));
  }

  /**
   * Entries in the shape the renderer reads.
   *
   * `id` and `slug` are merged in from their columns rather than trusted to be
   * present in `data`, so a template can rely on them regardless of how the row
   * was written.
   */
  async allOfType(typeKey: string): Promise<Entry[]> {
    const rows = await this.rowsOfType(typeKey);
    return rows.map((row) => ({ ...row.data, id: row.id, slug: row.slug ?? undefined }));
  }

  async countsByType(): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ typeKey: entries.typeKey, count: sql<number>`count(*)::int` })
      .from(entries)
      .where(this.scoped)
      .groupBy(entries.typeKey);

    return Object.fromEntries(rows.map((r) => [r.typeKey, r.count]));
  }
}
