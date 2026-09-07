/**
 * One site, and the operations on it.
 *
 * A facade over the repositories and use-cases rather than a class that does
 * the work. The first version was a
 * single `SiteRepository` holding loading, diffing, destructive gating,
 * migration, undo and history, which meant none of those could be tested or
 * changed without the rest, and every method reached for `as unknown as` to get
 * a `jsonb` column back into a usable shape.
 *
 * Now each operation is its own class with one `execute`, each repository
 * answers one kind of question, and the casts are gone because the columns are
 * typed at the schema.
 */
import type { SiteSpec } from "@forinda-cms/spec";
import type { Entry, EntrySource } from "@forinda-cms/render";

import type { Db } from "./client.js";
import { EntryRepository, PatchRepository, SpecRepository } from "./repositories/index.js";
import type { Scope } from "./scope.js";
import {
  ApplySpecUseCase,
  RedirectsUseCase,
  SiteHistoryUseCase,
  UndoSpecUseCase,
  type ApplySpecInput,
  type ApplySpecResult,
  type HistoryEntry,
  type UndoResult,
} from "./use-cases/index.js";

export class Site {
  readonly specs: SpecRepository;
  readonly patches: PatchRepository;
  readonly entries: EntryRepository;

  constructor(
    private readonly db: Db,
    private readonly scope: Scope,
  ) {
    this.specs = new SpecRepository(db, scope);
    this.patches = new PatchRepository(db, scope);
    this.entries = new EntryRepository(db, scope);
  }

  spec(): Promise<SiteSpec | null> {
    return this.specs.find();
  }

  applySpec(next: SiteSpec, input: ApplySpecInput): Promise<ApplySpecResult> {
    return new ApplySpecUseCase(this.db, this.scope).execute(next, input);
  }

  undo(): Promise<UndoResult | null> {
    return new UndoSpecUseCase(this.db, this.scope).execute();
  }

  history(limit?: number): Promise<HistoryEntry[]> {
    return new SiteHistoryUseCase(this.db, this.scope).execute(limit);
  }

  /**
   * Rows per declared type, zero-filled.
   *
   * A type with no entries reports `0` rather than being absent, so "nothing is
   * lost" can be said with confidence instead of inferred from a missing key —
   * which is what a destructive-change message depends on.
   */
  async entryCounts(spec: SiteSpec): Promise<Record<string, number>> {
    const zeros = Object.fromEntries(spec.content.map((t) => [t.key, 0]));
    return { ...zeros, ...(await this.entries.countsByType()) };
  }

  redirects(limit?: number): Promise<Map<string, string>> {
    return new RedirectsUseCase(this.db, this.scope).execute(limit);
  }

  /**
   * Rows for the renderer, behind the interface it already reads.
   *
   * The seam from ADR 0007: the renderer asks an `EntrySource` for rows and
   * cannot tell whether they were read from a file, computed by a derived type,
   * or selected from a table.
   */
  async entrySource(typeKeys: readonly string[]): Promise<EntrySource> {
    const loaded = new Map<string, readonly Entry[]>();
    await Promise.all(
      typeKeys.map(async (key) => {
        loaded.set(key, await this.entries.allOfType(key));
      }),
    );
    return { all: (type) => loaded.get(type) ?? [] };
  }
}
