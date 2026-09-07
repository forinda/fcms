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
import type { ContentType, Condition, Query, SiteSpec } from "@forinda-cms/spec";

import { generateSchedule } from "./schedule.js";

/** One row. Shape is the content type's fields; the renderer treats it as data. */
export type Entry = Record<string, unknown> & { readonly id?: string; readonly slug?: string };

export interface EntrySource {
  /** Every entry of a type, unfiltered. Filtering and sorting happen here, in `runQuery`. */
  all(type: string): readonly Entry[];
}

/** A source over plain objects — the file-backed spike, and every test. */
export function staticSource(data: Record<string, readonly Entry[]>): EntrySource {
  return { all: (type) => data[type] ?? [] };
}

function get(row: Entry, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, row);
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
  const actual = get(row, c.field.replace(/^item\./, ""));
  const expected = c.value;

  switch (c.op) {
    case "eq":
      return actual === expected;
    case "ne":
      return actual !== expected;
    case "lt":
      return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lte":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "gt":
      return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "gte":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual as never);
    case "contains":
      return typeof actual === "string" && typeof expected === "string"
        ? actual.toLowerCase().includes(expected.toLowerCase())
        : Array.isArray(actual) && actual.includes(expected as never);
  }
}

/** Run a bounded query. `limit` is mandatory in the schema, so it is always applied. */
/** What the visitor asked for: `?city=nairobi&sort=price&page=2`. */
export type RequestParams = Readonly<Record<string, string | readonly string[] | undefined>>;

export interface QueryResult {
  readonly rows: readonly Entry[];
  /** Rows matching the filters, before paging — "451 properties found". */
  readonly total: number;
  readonly page: number;
  readonly pages: number;
}

/**
 * One page of results, with the totals a pager needs.
 *
 * `runQuery` still returns just the rows, because most callers want those; this
 * is what a paginated listing uses.
 */
export function runQueryPage(
  source: EntrySource,
  query: Query,
  params: RequestParams = {},
): QueryResult {
  // Conditions are resolved once, not per row: a parameter's value does not
  // change halfway through a list, and an absent one drops its condition
  // entirely rather than being faked into something the matcher understands.
  const conditions = (query.where ?? []).flatMap((c) => {
    const resolved = resolveCondition(c, params);
    return resolved ? [resolved] : [];
  });

  const filtered = source.all(query.from).filter((row) => conditions.every((c) => matches(row, c)));

  const sorted = sortRows(filtered, query, params);
  const size = query.limit;

  // Paging only where the author asked for it. Without `page`, the query is the
  // first `limit` rows, exactly as before.
  if (!query.page) {
    return { rows: sorted.slice(0, size), total: sorted.length, page: 1, pages: 1 };
  }

  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const asked = Number(single(params[query.page.param]) ?? 1);
  // An out-of-range page shows the nearest real one rather than an empty list:
  // a stale link should not look like a site with nothing on it.
  const page = Number.isFinite(asked) ? Math.min(Math.max(1, Math.trunc(asked)), pages) : 1;

  return { rows: sorted.slice((page - 1) * size, page * size), total: sorted.length, page, pages };
}

export function runQuery(
  source: EntrySource,
  query: Query,
  params: RequestParams = {},
): readonly Entry[] {
  return runQueryPage(source, query, params).rows;
}

/** The first value, since a repeated parameter is a caller's mistake, not a list. */
function single(value: string | readonly string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : (value as string | undefined);
}

/**
 * A condition with its request parameter filled in, or nothing.
 *
 * Nothing when the parameter is absent and no default was declared: a search
 * page has to work before anything is typed (ADR 0019 §1). Returning a
 * match-everything condition instead would mean inventing an operator the
 * matcher does not have.
 */
function resolveCondition(condition: Condition, params: RequestParams): Condition | null {
  const value = condition.value;
  if (typeof value !== "object" || value === null || !("param" in value)) return condition;

  const supplied = single(params[value.param]);
  if (supplied === undefined || supplied === "") {
    return value.default === undefined ? null : { ...condition, value: value.default };
  }

  return { ...condition, value: coerce(supplied) };
}

/**
 * A form sends strings; the data holds numbers and booleans.
 *
 * Coerced here rather than at the schema, because what arrives is a string
 * either way and a filter that never matches is indistinguishable from no
 * results.
 */
function coerce(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function sortRows(rows: readonly Entry[], query: Query, params: RequestParams): readonly Entry[] {
  if (!query.sort) return rows;

  // A visitor-chosen sort is honoured only if it is on the author's list, so a
  // hand-edited URL cannot order by a column with no index (ADR 0019 §2).
  const chosen =
    "param" in query.sort
      ? (() => {
          const asked = single(params[query.sort.param]);
          const field =
            asked && query.sort.allow.includes(asked)
              ? asked
              : (query.sort.default ?? query.sort.allow[0]!);
          return { field, dir: query.sort.dir };
        })()
      : query.sort;

  {
    const { field, dir } = chosen;
    const sign = dir === "desc" ? -1 : 1;
    const sorted = [...rows].sort((a, b) => {
      const x = get(a, field);
      const y = get(b, field);
      if (x === y) return 0;
      // Missing values sort last regardless of direction — an entry that has not
      // filled the field in should not lead the list just because it is empty.
      if (x === undefined || x === null) return 1;
      if (y === undefined || y === null) return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * sign;
      return String(x).localeCompare(String(y)) * sign;
    });
    return sorted;
  }
}

export function contentTypeOf(spec: SiteSpec, key: string): ContentType | undefined {
  return spec.content.find((t) => t.key === key);
}

/**
 * Wrap a source so derived types resolve (ADR 0014, decision 1).
 *
 * This is the whole reason derived types cost the query language nothing:
 * `data`, `where`, `sort` and `limit` ask an `EntrySource` for rows and cannot
 * tell whether they were read or computed.
 *
 * Rows are computed once per wrap rather than per call, so two blocks querying
 * the same availability on one page agree with each other — a page that showed
 * a slot as free in one place and taken in another would be worse than either.
 */
export function withDerived(
  spec: SiteSpec,
  base: EntrySource,
  now: Date = new Date(),
): EntrySource {
  const cache = new Map<string, readonly Entry[]>();
  return {
    all(type) {
      const declared = contentTypeOf(spec, type);
      if (!declared?.derived) return base.all(type);
      const hit = cache.get(type);
      if (hit) return hit;
      const rows = generateSchedule(base, declared.derived, { now });
      cache.set(type, rows);
      return rows;
    },
  };
}
