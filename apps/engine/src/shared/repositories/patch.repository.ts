/**
 * The patch spine's rows.
 *
 * Doc 03 calls `spec_patches` the spine and says it is not deferrable; this is
 * the access to it. Every method returns a typed row, so a caller can read
 * `patch.inverse[0]?.value` with the compiler checking it rather than casting.
 */
import { Inject, Repository, Scope as Lifetime } from "@forinda/kickjs";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Classification, PatchOp } from "@forinda-cms/spec";

import { specPatches, type SpecPatchRow } from "@forinda-cms/db";
import type { Db, Executor, Scope } from "@forinda-cms/db";

import { DB } from "@/shared/db";
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

@Repository({ scope: Lifetime.REQUEST })
export class PatchRepository {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CURRENT_SCOPE) private readonly scope: Scope,
  ) {}

  private get scoped() {
    return and(eq(specPatches.orgId, this.scope.orgId), eq(specPatches.siteId, this.scope.siteId));
  }

  /**
   * The next sequence number.
   *
   * Read inside the caller's transaction so two concurrent applies cannot pick
   * the same value — the unique index on (site_id, seq) then rejects the second,
   * which is the behaviour we want rather than a silent interleave.
   */
  async nextSeq(tx: Executor = this.db): Promise<number> {
    const [row] = await tx
      .select({ next: sql<number>`coalesce(max(${specPatches.seq}), 0) + 1` })
      .from(specPatches)
      .where(this.scoped);
    return row?.next ?? 1;
  }

  async record(seq: number, patch: RecordPatch, tx: Executor = this.db): Promise<void> {
    await tx.insert(specPatches).values({
      siteId: this.scope.siteId,
      orgId: this.scope.orgId,
      seq,
      actor: patch.actor,
      source: patch.source,
      harness: patch.harness ?? null,
      ops: patch.ops,
      inverse: patch.inverse,
      classification: patch.classification,
      summary: patch.summary,
    });
  }

  /** The most recent patch that has not been undone. */
  async latestApplied(tx: Executor = this.db): Promise<SpecPatchRow | null> {
    const [row] = await tx
      .select()
      .from(specPatches)
      .where(and(this.scoped, isNull(specPatches.revertedAt)))
      .orderBy(desc(specPatches.seq))
      .limit(1);
    return row ?? null;
  }

  /** Marks rather than deletes: history stays append-only across an undo. */
  async markReverted(id: number, tx: Executor = this.db): Promise<void> {
    await tx.update(specPatches).set({ revertedAt: new Date() }).where(eq(specPatches.id, id));
  }

  async list(limit = 20): Promise<SpecPatchRow[]> {
    return this.db
      .select()
      .from(specPatches)
      .where(this.scoped)
      .orderBy(desc(specPatches.seq))
      .limit(limit);
  }
}
