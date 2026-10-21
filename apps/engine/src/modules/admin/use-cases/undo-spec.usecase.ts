/**
 * Undo the most recent change.
 *
 * Doc 13's argument that review can move to a non-developer rests on a wrong
 * "yes" being cheap to reverse. This is what makes that true: the inverse was
 * recorded at the time, so undo is a lookup rather than a reconstruction.
 */
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";
import { SiteSpec, valueOf } from "@forinda-cms/spec";

import type { Db, Scope } from "@forinda-cms/db";
import { PatchRepository, SpecRepository } from "@/shared/repositories";

import { DB } from "@/shared/db";
import { CURRENT_SCOPE } from "@/contributors/site.contributor";

export interface UndoResult {
  readonly seq: number;
  readonly summary: string;
}

@Service({ scope: Lifetime.REQUEST })
export class UndoSpecUseCase {
  private readonly specs: SpecRepository;
  private readonly patches: PatchRepository;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CURRENT_SCOPE) private readonly scope: Scope,
  ) {
    this.specs = new SpecRepository(db, scope);
    this.patches = new PatchRepository(db, scope);
  }

  async execute(): Promise<UndoResult | null> {
    return this.db.transaction(async (tx) => {
      const last = await this.patches.latestApplied(tx);
      if (!last) return null;

      // Narrowed rather than cast: `remove` and `move` carry no value, and the
      // helper says so instead of the column type pretending otherwise.
      const restored = valueOf(last.inverse[0]);

      if (restored === null) await this.specs.clear(tx);
      else await this.specs.save(SiteSpec.parse(restored), tx);

      // Marked, not deleted: "what happened to my site last Tuesday" has to
      // survive an undo.
      await this.patches.markReverted(last.id, tx);

      return { seq: last.seq, summary: last.summary };
    });
  }
}
