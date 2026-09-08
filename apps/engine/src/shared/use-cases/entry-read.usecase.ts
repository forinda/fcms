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

import { EntryRepository, type EntryPage, type EntryPageQuery } from "@/shared/repositories";

@Service({ scope: Lifetime.REQUEST })
export class EntryReadUseCase {
  constructor(@Inject(EntryRepository) private readonly entries: EntryRepository) {}

  rows(typeKey: string): Promise<EntryRow[]> {
    return this.entries.rowsOfType(typeKey);
  }

  /** One screenful, filtered and ordered — what the admin's list reads. */
  page(typeKey: string, query: EntryPageQuery): Promise<EntryPage> {
    return this.entries.pageOfType(typeKey, query);
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
  async source(
    typeKeys: readonly string[],
    viewer?: string | null,
    /**
     * Types whose unpublished rows must be loaded for everyone.
     *
     * Occupancy is not display: a room somebody has booked is held whether or
     * not anyone has published the booking, and a submission lands as a draft
     * (ADR 0020 §3). Without this a guest books a room and it stays on sale —
     * a double-booking with a moderation queue in front of it.
     *
     * The rows are still marked as drafts, so no query renders them; only the
     * availability generators read them (ADR 0025 §4).
     */
    unpublished: readonly string[] = [],
  ): Promise<EntrySource> {
    const held = new Set(unpublished);
    const loaded = new Map<string, readonly Entry[]>();
    await Promise.all(
      typeKeys.map(async (key) => {
        loaded.set(
          key,
          held.has(key)
            ? await this.entries.everyOfType(key)
            : await this.entries.allOfType(key, viewer),
        );
      }),
    );
    return { all: (type) => loaded.get(type) ?? [] };
  }
}
