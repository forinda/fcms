/**
 * A Postgres-backed `EntrySource`.
 *
 * This is the seam from ADR 0007 paying off. The renderer asks an `EntrySource`
 * for rows and cannot tell whether they were read from a file, computed by a
 * derived type, or selected from a table — so Phase 0b swaps the implementation
 * and **nothing above this line changes**.
 *
 * Rows are loaded per type and cached for the life of the source, which is one
 * render. That matters for the same reason `withDerived` caches: a page showing
 * a slot as free in one block and taken in another would be worse than either.
 */
import type { EntrySource, Entry } from "@forinda-cms/render";

import type { SiteRepository } from "./repository.js";

/**
 * `EntrySource.all` is synchronous because the renderer is, so rows are fetched
 * up front rather than lazily. The alternative — making the whole render path
 * async — would buy nothing here: a page renders every type it queries anyway,
 * and a spec is small enough that loading its content in one round trip is
 * cheaper than N awaited ones.
 */
export async function loadEntrySource(
  repo: SiteRepository,
  typeKeys: readonly string[],
): Promise<EntrySource> {
  const loaded = new Map<string, readonly Entry[]>();
  await Promise.all(
    typeKeys.map(async (key) => {
      loaded.set(key, (await repo.allEntries(key)) as Entry[]);
    }),
  );
  return { all: (type) => loaded.get(type) ?? [] };
}
