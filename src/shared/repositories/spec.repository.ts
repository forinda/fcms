/**
 * The stored spec. Reads and writes only — no diffing, no gating.
 *
 * Thin on purpose: a repository answers questions about rows, and the decisions
 * live in a use-case. The first version of this package
 * had one class doing loading, diffing, destructive gating, migration and
 * history, which made every one of those untestable without the others.
 */
import { Inject, Repository, Scope as Lifetime } from "@forinda/kickjs";
import { and, eq } from "drizzle-orm";
import { SiteSpec } from "@forinda-cms/spec";

import { siteSpecs, type SiteSpecRow } from "@forinda-cms/db";
import type { Db, Executor, Scope } from "@forinda-cms/db";

import { DB } from "@/shared/db";
import { CURRENT_SCOPE } from "@/contributors/site.contributor";

@Repository({ scope: Lifetime.REQUEST })
export class SpecRepository {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CURRENT_SCOPE) private readonly scope: Scope,
  ) {}

  private get scoped() {
    return and(eq(siteSpecs.orgId, this.scope.orgId), eq(siteSpecs.siteId, this.scope.siteId));
  }

  async findRow(): Promise<SiteSpecRow | null> {
    const [row] = await this.db.select().from(siteSpecs).where(this.scoped).limit(1);
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
    return row ? SiteSpec.parse(row.document) : null;
  }

  async save(document: SiteSpec, tx: Executor = this.db): Promise<void> {
    await tx
      .insert(siteSpecs)
      .values({
        siteId: this.scope.siteId,
        orgId: this.scope.orgId,
        document,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({ target: siteSpecs.siteId, set: { document, updatedAt: new Date() } });
  }

  async clear(tx: Executor = this.db): Promise<void> {
    await tx.delete(siteSpecs).where(this.scoped);
  }
}
