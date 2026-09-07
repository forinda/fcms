/**
 * Where rows come from, and how `data` queries run against them.
 *
 * Phase 0a has no database (ADR 0007), so entries are read from files. But the
 * renderer must not know that — hence `EntrySource`. In Phase 0b the same
 * interface is backed by Postgres and nothing above this line changes.
 *
 * That seam is worth having on day one for the reason ADR 0002 gives about all
 * of them: cheap now, expensive later.
 */
import type { ContentType, Condition, Query, SiteSpec } from '@forinda-cms/spec'

/** One row. Shape is the content type's fields; the renderer treats it as data. */
export type Entry = Record<string, unknown> & { readonly id?: string; readonly slug?: string }

export interface EntrySource {
  /** Every entry of a type, unfiltered. Filtering and sorting happen here, in `runQuery`. */
  all(type: string): readonly Entry[]
}

/** A source over plain objects — the file-backed spike, and every test. */
export function staticSource(data: Record<string, readonly Entry[]>): EntrySource {
  return { all: (type) => data[type] ?? [] }
}

function get(row: Entry, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== 'object') return undefined
    return (acc as Record<string, unknown>)[key]
  }, row)
}

/**
 * Evaluate one condition triple.
 *
 * Deliberately total: an unknown field is `undefined` and simply does not match,
 * rather than throwing. A missing field is an authoring mistake that
 * `checkReferences` catches at validate time — it should not take a live page
 * down at request time.
 */
export function matches(row: Entry, c: Condition): boolean {
  const actual = get(row, c.field.replace(/^item\./, ''))
  const expected = c.value

  switch (c.op) {
    case 'eq': return actual === expected
    case 'ne': return actual !== expected
    case 'lt': return typeof actual === 'number' && typeof expected === 'number' && actual < expected
    case 'lte': return typeof actual === 'number' && typeof expected === 'number' && actual <= expected
    case 'gt': return typeof actual === 'number' && typeof expected === 'number' && actual > expected
    case 'gte': return typeof actual === 'number' && typeof expected === 'number' && actual >= expected
    case 'in': return Array.isArray(expected) && expected.includes(actual as never)
    case 'contains':
      return typeof actual === 'string' && typeof expected === 'string'
        ? actual.toLowerCase().includes(expected.toLowerCase())
        : Array.isArray(actual) && actual.includes(expected as never)
  }
}

/** Run a bounded query. `limit` is mandatory in the schema, so it is always applied. */
export function runQuery(source: EntrySource, query: Query): readonly Entry[] {
  let rows = source.all(query.from).filter((row) => (query.where ?? []).every((c) => matches(row, c)))

  if (query.sort) {
    const { field, dir } = query.sort
    const sign = dir === 'desc' ? -1 : 1
    rows = [...rows].sort((a, b) => {
      const x = get(a, field)
      const y = get(b, field)
      if (x === y) return 0
      // Missing values sort last regardless of direction — an entry that has not
      // filled the field in should not lead the list just because it is empty.
      if (x === undefined || x === null) return 1
      if (y === undefined || y === null) return -1
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign
      return String(x).localeCompare(String(y)) * sign
    })
  }

  return rows.slice(0, query.limit)
}

export function contentTypeOf(spec: SiteSpec, key: string): ContentType | undefined {
  return spec.content.find((t) => t.key === key)
}
