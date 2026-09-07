/**
 * What has happened to this site.
 *
 * Returns a display shape rather than rows: the inverse is not something to put
 * in front of a person, and an audit view that leaked it would be showing the
 * whole previous spec on every line.
 */
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";
import type { Classification } from "@forinda-cms/spec";

import type { Db, Scope } from "@forinda-cms/db";
import { PatchRepository } from "@/shared/repositories";

import { DB } from "@/shared/db";
import { CURRENT_SCOPE } from "@/contributors/site.contributor";

export interface HistoryEntry {
  readonly seq: number;
  readonly actor: string;
  readonly source: string;
  readonly harness: string | null;
  readonly summary: string;
  readonly classification: Classification;
  readonly appliedAt: Date;
  readonly revertedAt: Date | null;
}

@Service({ scope: Lifetime.REQUEST })
export class SiteHistoryUseCase {
  private readonly patches: PatchRepository;

  constructor(@Inject(DB) db: Db, @Inject(CURRENT_SCOPE) scope: Scope) {
    this.patches = new PatchRepository(db, scope);
  }

  async execute(limit = 20): Promise<HistoryEntry[]> {
    const rows = await this.patches.list(limit);
    return rows.map((r) => ({
      seq: r.seq,
      actor: r.actor,
      source: r.source,
      harness: r.harness,
      summary: r.summary,
      classification: r.classification,
      appliedAt: r.appliedAt,
      revertedAt: r.revertedAt,
    }));
  }
}
