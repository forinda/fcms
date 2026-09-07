/**
 * Reading entries.
 *
 * Separate from `EntryWriteUseCase` because the two have nothing in common but
 * a table: a write validates against the content type and records what changed,
 * a read is a scoped select. The admin lists and the renderer resolves through
 * this one.
 */
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";
import type { EntryRow } from "@forinda-cms/db";
import type { Entry, EntrySource } from "@forinda-cms/render";
import type { SiteSpec } from "@forinda-cms/spec";

import { EntryRepository } from "@/shared/repositories";

@Service({ scope: Lifetime.REQUEST })
export class EntryReadUseCase {
  constructor(@Inject(EntryRepository) private readonly entries: EntryRepository) {}

  rows(typeKey: string): Promise<EntryRow[]> {
    return this.entries.rowsOfType(typeKey);
  }

  byId(id: string): Promise<EntryRow | null> {
    return this.entries.byId(id);
  }

  /**
   * Rows per declared type, zero-filled.
   *
   * A type with no entries reports `0` rather than being absent, so "nothing is
   * lost" can be said with confidence instead of inferred from a missing key —
   * which is what a destructive-change message depends on.
   */
  /** Drafts per type, so the admin can say "3 not published" beside the total. */
  drafts(): Promise<Record<string, number>> {
    return this.entries.draftCountsByType();
  }

  async counts(spec: SiteSpec): Promise<Record<string, number>> {
    const zeros = Object.fromEntries(spec.content.map((t) => [t.key, 0]));
    return { ...zeros, ...(await this.entries.countsByType()) };
  }

  /**
   * Rows for the renderer, behind the interface it already reads.
   *
   * The seam from ADR 0007: the renderer asks an `EntrySource` for rows and
   * cannot tell whether they were read from a file, computed by a derived type,
   * or selected from a table.
   */
  async source(typeKeys: readonly string[]): Promise<EntrySource> {
    const loaded = new Map<string, readonly Entry[]>();
    await Promise.all(
      typeKeys.map(async (key) => {
        loaded.set(key, await this.entries.allOfType(key));
      }),
    );
    return { all: (type) => loaded.get(type) ?? [] };
  }
}
