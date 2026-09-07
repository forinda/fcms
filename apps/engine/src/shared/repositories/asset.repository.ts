/**
 * The media library's rows.
 *
 * Scoped like everything else, with one twist ADR 0010 asks for: a null
 * `siteId` means the asset belongs to the organisation and is shared across its
 * sites, so a query has to match either.
 */
import { Inject, Repository, Scope as Lifetime } from "@forinda/kickjs";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

import { assets, type AssetRow } from "@forinda-cms/db";
import type { Db, Scope } from "@forinda-cms/db";

import { DB } from "@/shared/db";
import { CURRENT_SCOPE } from "@/contributors/site.contributor";

/** What a uuid looks like, so a URL cannot ask Postgres to parse one. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Repository({ scope: Lifetime.REQUEST })
export class AssetRepository {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CURRENT_SCOPE) private readonly scope: Scope,
  ) {}

  /** This site's assets and the org's shared ones (ADR 0010). */
  private get visible() {
    return and(
      eq(assets.orgId, this.scope.orgId),
      or(eq(assets.siteId, this.scope.siteId), isNull(assets.siteId)),
    );
  }

  list(limit = 200): Promise<AssetRow[]> {
    return this.db
      .select()
      .from(assets)
      .where(this.visible)
      .orderBy(desc(assets.createdAt))
      .limit(limit);
  }

  async byId(id: string): Promise<AssetRow | null> {
    // Shape-checked before it reaches Postgres. `id` arrives from a URL, and a
    // uuid column asked to compare against `../../etc/passwd` raises rather
    // than returning nothing — which turned a 404 into a 500 and put the
    // attempted path in the logs as an error.
    if (!UUID.test(id)) return null;

    const [row] = await this.db
      .select()
      .from(assets)
      .where(and(this.visible, eq(assets.id, id)));
    return row ?? null;
  }

  async create(values: {
    blobHash: string;
    filename: string;
    contentType: string;
    bytes: number;
    alt?: string | null;
  }): Promise<AssetRow> {
    const [row] = await this.db
      .insert(assets)
      .values({
        orgId: this.scope.orgId,
        siteId: this.scope.siteId,
        blobHash: values.blobHash,
        filename: values.filename,
        contentType: values.contentType,
        bytes: values.bytes,
        alt: values.alt ?? null,
      })
      .returning();
    return row!;
  }

  async setAlt(id: string, alt: string): Promise<boolean> {
    const rows = await this.db
      .update(assets)
      .set({ alt })
      .where(and(this.visible, eq(assets.id, id)))
      .returning({ id: assets.id });
    return rows.length > 0;
  }

  async remove(id: string): Promise<AssetRow | null> {
    const [row] = await this.db
      .delete(assets)
      .where(and(this.visible, eq(assets.id, id)))
      .returning();
    return row ?? null;
  }

  /**
   * How many rows still point at one blob.
   *
   * Content addressing means two uploads of the same photo share bytes, so
   * deleting one row must not delete the file the other one uses.
   */
  async blobUses(blobHash: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(assets)
      .where(eq(assets.blobHash, blobHash));
    return row?.count ?? 0;
  }
}
