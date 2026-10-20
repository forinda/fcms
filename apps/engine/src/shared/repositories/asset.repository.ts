/**
 * The media library's rows.
 *
 * Scoped like everything else, with one twist ADR 0010 asks for: a null
 * `siteId` means the asset belongs to the organisation and is shared across its
 * sites, so a query has to match either.
 */
import { Inject, Repository, Scope as Lifetime } from "@forinda/kickjs";
import { sql, type ExpressionBuilder } from "@forinda/kickjs-db";

import type { AssetRow, Kdb, KdbSchema, Scope } from "@forinda-cms/db";

import { KDB } from "@/shared/db";
import { CURRENT_SCOPE } from "@/contributors/site.contributor";

/** What a uuid looks like, so a URL cannot ask Postgres to parse one. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Repository({ scope: Lifetime.REQUEST })
export class AssetRepository {
  constructor(
    @Inject(KDB) private readonly db: Kdb,
    @Inject(CURRENT_SCOPE) private readonly scope: Scope,
  ) {}

  /** This site's assets and the org's shared ones (ADR 0010). */
  private readonly visible = (eb: ExpressionBuilder<KdbSchema, "assets">) =>
    eb.and([
      eb("orgId", "=", this.scope.orgId),
      eb.or([eb("siteId", "=", this.scope.siteId), eb("siteId", "is", null)]),
    ]);

  list(limit = 200): Promise<AssetRow[]> {
    return this.db
      .selectFrom("assets")
      .selectAll()
      .where(this.visible)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .execute();
  }

  async byId(id: string): Promise<AssetRow | null> {
    // Shape-checked before it reaches Postgres. `id` arrives from a URL, and a
    // uuid column asked to compare against `../../etc/passwd` raises rather
    // than returning nothing — which turned a 404 into a 500 and put the
    // attempted path in the logs as an error.
    if (!UUID.test(id)) return null;

    const row = await this.db
      .selectFrom("assets")
      .selectAll()
      .where(this.visible)
      .where("id", "=", id)
      .executeTakeFirst();
    return row ?? null;
  }

  create(values: {
    blobHash: string;
    filename: string;
    contentType: string;
    bytes: number;
    alt?: string | null;
  }): Promise<AssetRow> {
    return this.db
      .insertInto("assets")
      .values({
        orgId: this.scope.orgId,
        siteId: this.scope.siteId,
        blobHash: values.blobHash,
        filename: values.filename,
        contentType: values.contentType,
        bytes: values.bytes,
        alt: values.alt ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async setAlt(id: string, alt: string): Promise<boolean> {
    const rows = await this.db
      .updateTable("assets")
      .set({ alt })
      .where(this.visible)
      .where("id", "=", id)
      .returning("id")
      .execute();
    return rows.length > 0;
  }

  async remove(id: string): Promise<AssetRow | null> {
    const row = await this.db
      .deleteFrom("assets")
      .where(this.visible)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    return row ?? null;
  }

  /**
   * How many rows still point at one blob.
   *
   * Content addressing means two uploads of the same photo share bytes, so
   * deleting one row must not delete the file the other one uses.
   */
  async blobUses(blobHash: string): Promise<number> {
    const row = await this.db
      .selectFrom("assets")
      .select(sql<number>`count(*)::int`.as("count"))
      .where("blobHash", "=", blobHash)
      .executeTakeFirst();
    return row?.count ?? 0;
  }
}
