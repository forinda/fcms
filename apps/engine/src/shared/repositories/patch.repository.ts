/**
 * The patch spine's rows.
 *
 * Doc 03 calls `spec_patches` the spine and says it is not deferrable; this is
 * the access to it. Every method returns a typed row, so a caller can read
 * `patch.inverse[0]?.value` with the compiler checking it rather than casting.
 */
import { Inject, Repository, Scope as Lifetime } from "@forinda/kickjs";
import { and, eq, isNull, sql } from "@forinda/kickjs-db";
import type { Classification, PatchOp } from "@forinda-cms/spec";

import { tables, type Kdb, type Scope } from "@forinda-cms/db";

import { KDB } from "@/shared/db";
import { CURRENT_SCOPE } from "@/contributors/site.contributor";

export interface RecordPatch {
  readonly ops: PatchOp[];
  readonly inverse: PatchOp[];
  readonly classification: Classification;
  readonly summary: string;
  readonly actor: string;
  readonly source: string;
  readonly harness?: string | undefined;
}

const patches = tables.specPatches;

/**
 * An array for a `jsonb` column. node-postgres binds a JS array as a Postgres
 * array literal (`{…}`), which jsonb rejects; objects it stringifies. So the
 * ops — always an array — go across as JSON text and are cast.
 */
const jsonb = <T>(value: T) => sql<T>`${JSON.stringify(value)}::jsonb`;

@Repository({ scope: Lifetime.REQUEST })
export class PatchRepository {
  constructor(
    @Inject(KDB) private readonly db: Kdb,
    @Inject(CURRENT_SCOPE) private readonly scope: Scope,
  ) {}

  private get scoped() {
    return and(eq(patches.orgId, this.scope.orgId), eq(patches.siteId, this.scope.siteId));
  }

  /**
   * The next sequence number.
   *
   * Read inside the caller's transaction so two concurrent applies cannot pick
   * the same value — the unique index on (site_id, seq) then rejects the second,
   * which is the behaviour we want rather than a silent interleave.
   */
  async nextSeq(tx: Kdb = this.db): Promise<number> {
    const row = await tx
      .selectFrom("spec_patches")
      .select(sql<number>`coalesce(max(seq), 0)::int + 1`.as("next"))
      .where(this.scoped)
      .executeTakeFirst();
    return row?.next ?? 1;
  }

  async record(seq: number, patch: RecordPatch, tx: Kdb = this.db): Promise<void> {
    await tx
      .insertInto("spec_patches")
      .values({
        siteId: this.scope.siteId,
        orgId: this.scope.orgId,
        seq,
        actor: patch.actor,
        source: patch.source,
        harness: patch.harness ?? null,
        ops: jsonb(patch.ops),
        inverse: jsonb(patch.inverse),
        classification: patch.classification,
        summary: patch.summary,
      })
      .execute();
  }

  /** The most recent patch that has not been undone. */
  async latestApplied(tx: Kdb = this.db) {
    const row = await tx
      .selectFrom("spec_patches")
      .selectAll()
      .where(and(this.scoped, isNull(patches.revertedAt)))
      .orderBy("seq", "desc")
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  /** Marks rather than deletes: history stays append-only across an undo. */
  async markReverted(id: bigint, tx: Kdb = this.db): Promise<void> {
    await tx
      .updateTable("spec_patches")
      .set({ revertedAt: new Date() })
      .where(eq(patches.id, id))
      .execute();
  }

  async list(limit = 20) {
    return this.db
      .selectFrom("spec_patches")
      .selectAll()
      .where(this.scoped)
      .orderBy("seq", "desc")
      .limit(limit)
      .execute();
  }
}
