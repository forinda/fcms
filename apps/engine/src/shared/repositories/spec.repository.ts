/**
 * The stored spec. Reads and writes only — no diffing, no gating.
 *
 * Thin on purpose: a repository answers questions about rows, and the decisions
 * live in a use-case. The first version of this package
 * had one class doing loading, diffing, destructive gating, migration and
 * history, which made every one of those untestable without the others.
 */
import { Inject, Repository, Scope as Lifetime } from "@forinda/kickjs";
import { and, eq } from "@forinda/kickjs-db";
import { SiteSpec, migrateSpec, SPEC_VERSION } from "@forinda-cms/spec";

import { tables, type Kdb, type Scope } from "@forinda-cms/db";

import { KDB } from "@/shared/db";
import { CURRENT_SCOPE } from "@/contributors/site.contributor";

@Repository({ scope: Lifetime.REQUEST })
export class SpecRepository {
  constructor(
    @Inject(KDB) private readonly db: Kdb,
    @Inject(CURRENT_SCOPE) private readonly scope: Scope,
  ) {}

  private get scoped() {
    return and(
      eq(tables.siteSpecs.orgId, this.scope.orgId),
      eq(tables.siteSpecs.siteId, this.scope.siteId),
    );
  }

  async findRow() {
    const row = await this.db
      .selectFrom("site_specs")
      .selectAll()
      .where(this.scoped)
      .executeTakeFirst();
    return row ?? null;
  }

  /**
   * The current spec, parsed.
   *
   * Parsed rather than trusted even though the column is typed: `$type<>` is a
   * compile-time assertion about what we wrote, and this row may have been
   * written by an older version of the schema. The type says what it should be;
   * the parse says what it is.
   */
  async find(): Promise<SiteSpec | null> {
    const row = await this.findRow();
    // Brought forward on read (ADR 0003 §3): a stored document may predate the
    // current shape, and an install whose site stops loading after an upgrade
    // is the failure `specVersion` exists to prevent.
    return row ? SiteSpec.parse(migrateSpec(row.document, SPEC_VERSION)) : null;
  }

  async save(document: SiteSpec, tx: Kdb = this.db): Promise<void> {
    await tx
      .insertInto("site_specs")
      .values({
        siteId: this.scope.siteId,
        orgId: this.scope.orgId,
        document,
        updatedAt: new Date(),
      })
      .onConflict((oc) => oc.column("siteId").doUpdateSet({ document, updatedAt: new Date() }))
      .execute();
  }

  async clear(tx: Kdb = this.db): Promise<void> {
    await tx.deleteFrom("site_specs").where(this.scoped).execute();
  }
}
