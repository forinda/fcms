/**
 * Queries that read the request (ADR 0019 §1–2).
 *
 * The listing page is the page a marketplace hangs off, and it is the first
 * thing in the spec that a *visitor* controls. So the tests here are mostly
 * about what a hand-edited URL cannot do: sort by a column nobody indexed, page
 * past the end, or turn a filter into an error.
 */
import { describe, expect, it } from "vitest";
import { Query } from "@forinda-cms/spec";

import { runQueryPage, staticSource, type QueryResult } from "./entries.js";

const services = [
  { id: "1", slug: "cut", name: "Cut and finish", price: 1500, minutes: 45, active: true },
  { id: "2", slug: "colour", name: "Full colour", price: 4500, minutes: 120, active: true },
  { id: "3", slug: "braids", name: "Braids", price: 3500, minutes: 180, active: true },
  { id: "4", slug: "old", name: "Retired", price: 900, minutes: 30, active: false },
];

const source = staticSource({ service: services });

const query = (extra: Record<string, unknown> = {}) =>
  Query.parse({
    from: "service",
    where: [
      { field: "active", op: "eq", value: true },
      { field: "name", op: "contains", value: { param: "q" } },
      { field: "price", op: "lte", value: { param: "max_price" } },
    ],
    limit: 2,
    ...extra,
  });

const names = (result: QueryResult) => result.rows.map((row) => row["name"]);

describe("filters from the request", () => {
  it("ignores a parameter nobody supplied", () => {
    // A search page has to work before anything is typed, so an unfilled filter
    // drops its condition rather than matching nothing.
    const result = runQueryPage(source, query(), {});
    expect(result.total).toBe(3);
  });

  it("applies one when it arrives", () => {
    expect(names(runQueryPage(source, query(), { q: "Braid" }))).toEqual(["Braids"]);
  });

  it("coerces the string a form sends into the field's type", () => {
    // Everything arrives as text; a filter comparing "1500" to 1500 as strings
    // would never match, and would look like "no results" rather than a bug.
    expect(names(runQueryPage(source, query(), { max_price: "1500" }))).toEqual(["Cut and finish"]);
  });

  it("keeps the author's own conditions regardless", () => {
    // `active: true` is the author's, not the visitor's — a request cannot
    // widen a query, only narrow it.
    const result = runQueryPage(source, query(), { q: "Retired" });
    expect(result.total).toBe(0);
  });

  it("uses a declared default when the parameter is absent", () => {
    const withDefault = Query.parse({
      from: "service",
      where: [{ field: "price", op: "lte", value: { param: "max_price", default: 2000 } }],
      limit: 10,
    });
    expect(names(runQueryPage(source, withDefault, {}))).toEqual(["Cut and finish", "Retired"]);
  });
});

describe("sort chosen by the visitor", () => {
  const sorted = Query.parse({
    from: "service",
    where: [{ field: "active", op: "eq", value: true }],
    sort: { param: "sort", allow: ["price", "minutes"], default: "price" },
    limit: 10,
  });

  it("honours a field on the author's list", () => {
    expect(names(runQueryPage(source, sorted, { sort: "minutes" }))).toEqual([
      "Cut and finish",
      "Full colour",
      "Braids",
    ]);
  });

  it("ignores one that is not, rather than ordering by an unindexed column", () => {
    // The whole reason `allow` is a closed list: a hand-edited URL must not be
    // able to order by anything the author did not plan for.
    expect(names(runQueryPage(source, sorted, { sort: "name" }))).toEqual(
      names(runQueryPage(source, sorted, {})),
    );
  });
});

describe("paging", () => {
  const paged = Query.parse({
    from: "service",
    where: [{ field: "active", op: "eq", value: true }],
    sort: { field: "price", dir: "asc" },
    page: { param: "page" },
    limit: 2,
  });

  it("reports the total before paging, not the page size", () => {
    // "451 properties found" is the number that matters, and it is not the
    // number of rows on the screen.
    const result = runQueryPage(source, paged, {});
    expect(result.total).toBe(3);
    expect(result.rows).toHaveLength(2);
    expect(result.pages).toBe(2);
  });

  it("returns the asked-for page", () => {
    expect(names(runQueryPage(source, paged, { page: "2" }))).toEqual(["Full colour"]);
  });

  it("clamps a page past the end instead of showing an empty site", () => {
    const result = runQueryPage(source, paged, { page: "99" });
    expect(result.page).toBe(2);
    expect(result.rows).toHaveLength(1);
  });

  it("ignores a page that is not a number", () => {
    expect(runQueryPage(source, paged, { page: "../etc/passwd" }).page).toBe(1);
  });

  it("does not page a query that never asked to be paged", () => {
    const result = runQueryPage(source, query(), {});
    expect(result.pages).toBe(1);
    expect(result.rows).toHaveLength(2);
  });
});
