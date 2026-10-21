/**
 * Undo the most recent change.
 *
 * Doc 13's argument that review can move to a non-developer rests on a wrong
 * "yes" being cheap to reverse. This is what makes that true: the inverse was
 * recorded at the time, so undo is a lookup rather than a reconstruction.
 */
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";
import { SiteSpec, valueOf } from "@forinda-cms/spec";

import type { Db } from "@forinda-cms/db";
import { PatchRepository, SpecRepository } from "@/shared/repositories";

import { DB } from "@/shared/db";
import type { Role } from "@/shared/roles";
import { NotAllowedError, notAllowed } from "./apply-spec.usecase";

const specOf = (value: unknown): SiteSpec | null => (value == null ? null : SiteSpec.parse(value));

export interface UndoResult {
  readonly seq: number;
  readonly summary: string;
}

@Service({ scope: Lifetime.REQUEST })
export class UndoSpecUseCase {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SpecRepository) private readonly specs: SpecRepository,
    @Inject(PatchRepository) private readonly patches: PatchRepository,
  ) {}

  /**
   * @param role Who is asking. Undo writes a spec, so it is held to what an
   *   apply of the restored document would need (ADR 0008 §2): a manager to
   *   change the site at all, a developer if it takes tier-3 CSS with it.
   *   Required, as it is on apply, so no door can leave it out.
   */
  async execute(role: Role): Promise<UndoResult | null> {
    return this.db.transaction(async (tx) => {
      const last = await this.patches.latestApplied(tx);
      if (!last) return null;

      // Narrowed rather than cast: `remove` and `move` carry no value, and the
      // helper says so instead of the column type pretending otherwise.
      const restored = specOf(valueOf(last.inverse[0]));

      // Judged against what *this patch* produced, not against the stored
      // spec read separately: both sides come from the one row being undone,
      // so a patch landing in between cannot make the check about a different
      // change than the one reversed. (Read apart, a manager's undo could take
      // a developer's CSS that arrived after the manager looked.)
      const refused = notAllowed(role, restored, specOf(valueOf(last.ops[0])));
      if (refused) throw new NotAllowedError(refused);

      if (restored === null) await this.specs.clear(tx);
      else await this.specs.save(restored, tx);

      // Marked, not deleted: "what happened to my site last Tuesday" has to
      // survive an undo.
      await this.patches.markReverted(last.id, tx);

      return { seq: last.seq, summary: last.summary };
    });
  }
}
