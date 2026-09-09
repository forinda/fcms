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
import type { ContentType, Condition, Field, Operand, Query, SiteSpec } from "@forinda-cms/spec";

import { generateSchedule } from "./schedule.js";
import { generateStay } from "./stay.js";
import { addDistance } from "./places.js";

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
 * A reference held as `ref:<type>/<slug>`, compared against what it points at.
 *
 * A reference field stores the long form. An `{ entry: slug }` resolves to the
 * bare slug, and an id resolves to an id — so a filter written the only way it
 * can be written matched nothing, and a property page showed none of its own
 * reviews. Aggregates already accept both forms; a filter has to agree with
 * them, or the same relationship is two different relationships depending on
 * which part of the page is asking.
 */
function sameValue(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  if (!actual.startsWith("ref:")) return false;
  // `ref:property/nyali-beach` is the same property as `nyali-beach`, and as
  // `ref:property/nyali-beach`. It is not the same as `beach`.
  return actual.slice(actual.indexOf("/") + 1) === expected;
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
  // Two callers, two shapes. A query's `where` names a field of the row it is
  // filtering — `price`. A block's `when` names a path into the scope —
  // `entry.photo`, `item.photo` — and the scope is what it is given.
  //
  // Stripping `item.` served the first and broke the second: inside a list
  // item, `item.photo` became `photo`, which is not on the scope either, so a
  // `when` on an item matched nothing at all and did so silently. The full path
  // is tried first, and the stripped one is the fallback that keeps the queries
  // working.
  const direct = get(row, c.field);
  const actual = direct === undefined ? get(row, c.field.replace(/^item\./, "")) : direct;
  const expected = c.value;

  switch (c.op) {
    case "eq":
      return sameValue(actual, expected);
    case "ne":
      return !sameValue(actual, expected);
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
    case "exists":
      // A value somebody would see. `null`, `undefined` and `""` are all "no
      // photo"; `false` and `0` are answers and count as present.
      return actual !== undefined && actual !== null && actual !== "";
    case "empty":
      return actual === undefined || actual === null || actual === "";
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
/**
 * Markers the platform puts on a row, which no spec can name.
 *
 * Field names are camelCase and cannot start with an underscore, so these
 * cannot collide with anything an author declares — and neither is ever
 * rendered (ADR 0027, consequences).
 */
export const VISITOR_KEY = "_visitor";
export const DRAFT_KEY = "_draft";

/** Who is asking, when anybody is. Never read from a request parameter. */
export type Viewer = string | null | undefined;

/**
 * The rows this query may see.
 *
 * Two filters, and the order matters: an unpublished row is visible only to its
 * author, and only when the query asked for the author's own rows. A page that
 * forgets `mine` cannot list drafts, because the draft filter is on by default.
 */
function visible(rows: readonly Entry[], query: Query, viewer: Viewer): readonly Entry[] {
  if (!query.mine) return rows.filter((row) => row[DRAFT_KEY] !== true);
  // Signed out: nothing. Not everything, and not an error.
  if (!viewer) return [];
  return rows.filter((row) => row[VISITOR_KEY] === viewer);
}

export function runQueryPage(
  source: EntrySource,
  query: Query,
  params: RequestParams = {},
  viewer: Viewer = null,
  entry?: Entry,
): QueryResult {
  // Conditions are resolved once, not per row: a parameter's value does not
  // change halfway through a list, and an absent one drops its condition
  // entirely rather than being faked into something the matcher understands.
  const conditions: Condition[] = [];
  for (const c of query.where ?? []) {
    const resolved = resolveCondition(c, params, entry);
    if (resolved) {
      conditions.push(resolved);
      continue;
    }
    // A `param` that resolves to nothing drops its condition, because a search
    // page has to work before anything is typed. An `entry` that resolves to
    // nothing must not: "the rooms of this property", with no property, is zero
    // rooms — never every room on the site.
    if (isEntryValue(c.value)) return { rows: [], total: 0, page: 1, pages: 1 };
  }

  const filtered = visible(source.all(query.from), query, viewer).filter((row) =>
    conditions.every((c) => matches(row, c)),
  );

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

/**
 * Rows the query matches with one parameter left out.
 *
 * What a facet counts: ticking "4 stars" should not make every other star
 * rating read zero, so the facet's own filter is excluded from its own counts.
 */
export function runQueryExcluding(
  source: EntrySource,
  query: Query,
  params: RequestParams,
  exclude: string,
  entry?: Entry,
): readonly Entry[] {
  const conditions = (query.where ?? []).flatMap((c) => {
    const value = c.value;
    if (
      typeof value === "object" &&
      value !== null &&
      "param" in value &&
      value.param === exclude
    ) {
      return [];
    }
    const resolved = resolveCondition(c, params, entry);
    return resolved ? [resolved] : [];
  });

  // Facets count what everyone else can see: a visitor's own draft is not part
  // of what anybody is choosing from, so this reads the published rows only.
  return visible(source.all(query.from), { ...query, mine: false }, null).filter((row) =>
    conditions.every((c) => matches(row, c)),
  );
}

export function runQuery(
  source: EntrySource,
  query: Query,
  params: RequestParams = {},
  viewer: Viewer = null,
  entry?: Entry,
): readonly Entry[] {
  return runQueryPage(source, query, params, viewer, entry).rows;
}

/** The first value, since a repeated parameter is a caller's mistake, not a list. */
function isEntryValue(value: Condition["value"]): value is { entry: string } {
  return typeof value === "object" && value !== null && "entry" in value;
}

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
function resolveCondition(
  condition: Condition,
  params: RequestParams,
  entry?: Entry,
): Condition | null {
  const value = condition.value;
  if (typeof value !== "object" || value === null) return condition;

  // The page's own row. Dropping the condition when there is none would show
  // every row on the site, which is the failure this exists to prevent — so an
  // absent entry matches nothing instead.
  if ("entry" in value) {
    if (!entry) return null;
    const supplied = entry[value.entry];
    if (supplied === undefined || supplied === null) return null;
    return { ...condition, value: supplied as Condition["value"] };
  }

  if (!("param" in value)) return condition;

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
/**
 * Which generator owns this kind.
 *
 * `kind` comes from a fixed registry (ADR 0014), so this is a lookup rather
 * than a chain of conditions that grows a branch per shape of availability.
 */
function derive(
  derived: NonNullable<ContentType["derived"]>,
  base: EntrySource,
  enriched: EntrySource,
  now: Date,
  params: RequestParams,
): readonly Entry[] {
  // A stay reads its resources through the enriched source, so a room's
  // aggregate rating and computed fields are on the row a search returns.
  return derived.kind === "schedule"
    ? generateSchedule(base, derived, { now })
    : generateStay(enriched, derived, { now, params });
}

export function withDerived(
  spec: SiteSpec,
  base: EntrySource,
  now: Date = new Date(),
  /** Computed fields may read the request — "three nights" is a parameter. */
  params: RequestParams = {},
): EntrySource {
  const cache = new Map<string, readonly Entry[]>();

  const source: EntrySource = {
    all(type) {
      const declared = contentTypeOf(spec, type);
      if (!declared) return base.all(type);

      const hit = cache.get(type);
      if (hit) return hit;

      // Derived types are generated; stored types are read. Either way the rows
      // then get their aggregate fields, so a hotel's rating is present whether
      // the hotel is stored or computed.
      const rows = declared.derived
        ? derive(declared.derived, base, source, now, params)
        : base.all(type);

      // Distance before computed, so a formula can read it: "price per
      // kilometre" is a thing an author will want long before we do.
      const enriched = addComputed(
        declared,
        addDistance(declared, addAggregates(declared, rows, source), params),
        params,
        source,
      );
      cache.set(type, enriched);
      return enriched;
    },
  };

  return source;
}

/**
 * Fill in a type's aggregate fields (ADR 0019 §4).
 *
 * Computed here rather than in the page, so the value can be sorted on,
 * filtered by and read in a template like any other field — "sort by rating" is
 * the whole reason it exists.
 *
 * Aggregates over a type that itself aggregates are not supported and cannot
 * loop: the related rows are read through the same source, and a cycle would
 * have to be declared in two directions to occur. Worth watching if that
 * becomes possible.
 */
function addAggregates(
  type: ContentType,
  rows: readonly Entry[],
  source: EntrySource,
): readonly Entry[] {
  const aggregates = type.fields.filter(
    (field): field is Extract<Field, { type: "aggregate" }> => field.type === "aggregate",
  );
  if (aggregates.length === 0) return rows;

  return rows.map((row) => {
    const computed: Record<string, unknown> = { ...row };

    for (const field of aggregates) {
      // Rows of the related type that point back at this one, by either form a
      // reference takes: the row's id, or `ref:<type>/<slug>` — which is the
      // form the spec documents and the form every authored file uses.
      // Matching only the id meant a hotel's rating, review count and cheapest
      // room were all empty on a site whose content was written rather than
      // clicked, which is the site the CLI exists to make.
      const related = source
        .all(field.of)
        .filter((other) => referencesRow(other[field.on], row, type.key));

      computed[field.name] = aggregate(field, related);
    }

    return computed;
  });
}

/**
 * Work out a type's computed fields (ADR 0019 §5).
 *
 * After the aggregates, deliberately: "value for money" is a rating divided by
 * a price, so a formula has to be able to read a field the engine just filled
 * in. Computed fields cannot read each other — one pass, in declaration order,
 * and anything more would be an evaluation order to reason about.
 */
function addComputed(
  type: ContentType,
  rows: readonly Entry[],
  params: RequestParams,
  source?: EntrySource,
): readonly Entry[] {
  const computed = type.fields.filter(
    (field): field is Extract<Field, { type: "computed" }> => field.type === "computed",
  );
  if (computed.length === 0) return rows;

  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };

    /** The number on the row a reference field points at, or nothing. */
    const follow = (referenceField: string, wanted: string): number | null => {
      const declared = type.fields.find((f) => f.name === referenceField);
      if (!declared || declared.type !== "reference" || !source) return null;
      // A `many` reference has no single row to read a number from, and
      // summing one silently would be an aggregate wearing a formula's clothes.
      if ("many" in declared && declared.many) return null;

      const target = source
        .all(declared.to)
        .find((other) => referencesRow(row[referenceField], other, declared.to));
      const value = target?.[wanted];
      return typeof value === "number" ? value : null;
    };

    for (const field of computed) {
      const value = evaluate(field.formula, row, params, follow);
      const factor = 10 ** field.precision;
      out[field.name] = value === null ? null : Math.round(value * factor) / factor;
    }
    return out;
  });
}

/**
 * One formula, or `null`.
 *
 * Null propagates rather than becoming zero: a nightly rate with no price is
 * unknown, and a total of 0 would be a claim about it. Division by zero is null
 * for the same reason — it is not infinity, it is a question with no answer.
 */
/**
 * One formula, against one row.
 *
 * Exported because a price is evaluated in two places and must agree in both:
 * the renderer, which shows it, and the payment, which charges it. Two
 * evaluators would be two prices, and the second one is the one with money
 * attached.
 *
 * `follow` resolves a `{ ref, field }` hop. A caller that cannot follow
 * references passes nothing, and a hop is then null rather than wrong.
 */
export function evaluateFormula(
  operand: Operand,
  row: Entry,
  params: RequestParams = {},
  follow?: (referenceField: string, wanted: string) => number | null,
): number | null {
  return evaluate(operand, row, params, follow);
}

function evaluate(
  operand: Operand,
  row: Entry,
  params: RequestParams,
  follow?: (referenceField: string, wanted: string) => number | null,
): number | null {
  if ("value" in operand) return operand.value;

  // One hop across a declared reference: the price of the room this booking
  // points at. Checked at validate time, so an unresolvable hop is a spec
  // error rather than a silent null on a live page.
  if ("ref" in operand) return follow ? follow(operand.ref, operand.field) : null;

  if ("field" in operand) {
    const value = row[operand.field];
    return typeof value === "number" ? value : null;
  }

  if ("param" in operand) {
    const supplied = params[operand.param];
    const raw = Array.isArray(supplied) ? supplied[0] : supplied;
    const parsed = raw === undefined || raw === "" ? undefined : Number(raw);
    if (parsed !== undefined && Number.isFinite(parsed)) return parsed;
    return operand.default ?? null;
  }

  const values = operand.of.map((child) => evaluate(child, row, params, follow));
  if (values.some((value) => value === null)) return null;

  const numbers = values as number[];
  const [first = 0, ...rest] = numbers;

  switch (operand.op) {
    case "add":
      return numbers.reduce((total, value) => total + value, 0);
    case "subtract":
      return rest.reduce((total, value) => total - value, first);
    case "multiply":
      return numbers.reduce((total, value) => total * value, 1);
    case "divide":
      // A zero denominator is not infinity; it is a question with no answer.
      return rest.some((value) => value === 0)
        ? null
        : rest.reduce((total, value) => total / value, first);
    case "min":
      return Math.min(...numbers);
    case "max":
      return Math.max(...numbers);
    default:
      return Math.round(first);
  }
}

/** A reference may hold one id or several (`many: true`). */
function referencesRow(value: unknown, row: Entry, typeKey: string): boolean {
  const targets = new Set<string>();
  if (row["id"] !== undefined && row["id"] !== null) targets.add(String(row["id"]));
  if (row["slug"] !== undefined && row["slug"] !== null) {
    targets.add(`ref:${typeKey}/${String(row["slug"])}`);
  }
  if (targets.size === 0) return false;

  if (Array.isArray(value)) return value.some((entry) => targets.has(String(entry)));
  return value !== undefined && value !== null && targets.has(String(value));
}

function aggregate(
  field: Extract<Field, { type: "aggregate" }>,
  rows: readonly Entry[],
): number | null {
  if (field.fn === "count") return rows.length;

  const numbers = rows
    .map((row) => (field.field ? row[field.field] : undefined))
    .filter((value): value is number => typeof value === "number");

  // Null rather than zero for an empty set: a hotel with no reviews has no
  // rating, and showing it as 0.0 would sort it below the worst-reviewed one.
  if (numbers.length === 0) return null;

  switch (field.fn) {
    case "sum":
      return numbers.reduce((total, value) => total + value, 0);
    case "min":
      return Math.min(...numbers);
    case "max":
      return Math.max(...numbers);
    default: {
      const mean = numbers.reduce((total, value) => total + value, 0) / numbers.length;
      const factor = 10 ** field.precision;
      return Math.round(mean * factor) / factor;
    }
  }
}
