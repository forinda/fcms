/**
 * The listing page, end to end (ADR 0019).
 *
 * Written against the shape this is aiming at — properties, reviews, a filter
 * rail with counts, a rating you can sort by — because the point of the ADR is
 * that the spec can express *that page*, and the only honest test of it is that
 * page.
 */
import { describe, expect, it } from "vitest";
import { SiteSpec } from "@forinda-cms/spec";

import { runQueryExcluding, runQueryPage, staticSource, withDerived } from "./entries.js";
import { renderPage } from "./render.js";

const spec = SiteSpec.parse({
  specVersion: 1,
  name: "Stays",
  theme: { colors: { brand: "#003580" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
  content: [
    {
      key: "property",
      label: "Property",
      titleField: "name",
      fields: [
        { name: "name", label: "Name", type: "text", required: true },
        { name: "city", label: "City", type: "text", filterable: true },
        { name: "stars", label: "Stars", type: "number", filterable: true },
        { name: "price", label: "Price per night", type: "number", filterable: true },
        // The two that make it a marketplace rather than a list.
        {
          name: "rating",
          label: "Guest rating",
          type: "aggregate",
          of: "review",
          on: "property",
          field: "score",
          fn: "avg",
          filterable: true,
        },
        {
          name: "reviews",
          label: "Reviews",
          type: "aggregate",
          of: "review",
          on: "property",
          fn: "count",
        },
      ],
    },
    {
      key: "review",
      label: "Review",
      fields: [
        { name: "property", label: "Property", type: "reference", to: "property" },
        { name: "score", label: "Score", type: "number" },
      ],
    },
  ],
  pages: [
    {
      key: "search",
      path: "/search",
      title: "Search",
      blocks: [
        { type: "facets", attrs: { field: "city", param: "city", title: "City" } },
        { type: "results-count", attrs: { one: "{n} property", many: "{n} properties" } },
        {
          type: "list",
          data: {
            from: "property",
            where: [
              { field: "city", op: "eq", value: { param: "city" } },
              { field: "price", op: "lte", value: { param: "max_price" } },
            ],
            sort: { param: "sort", allow: ["price", "rating"], default: "price" },
            page: { param: "page" },
            limit: 2,
          },
          item: [{ type: "card", attrs: { heading: "{{ item.name }}", body: "{{ item.city }}" } }],
        },
        { type: "pager" },
      ],
    },
  ],
});

const base = staticSource({
  property: [
    { id: "p1", slug: "grand", name: "The Grand", city: "Nairobi", stars: 5, price: 12000 },
    { id: "p2", slug: "riverside", name: "Riverside Inn", city: "Nairobi", stars: 3, price: 4500 },
    { id: "p3", slug: "coast", name: "Coast House", city: "Mombasa", stars: 4, price: 8000 },
  ],
  review: [
    { id: "r1", property: "p1", score: 9 },
    { id: "r2", property: "p1", score: 8 },
    { id: "r3", property: "p2", score: 6 },
  ],
});

const source = withDerived(spec, base);
const query = spec.pages[0]!.blocks[2]!.data!;

describe("aggregates", () => {
  it("averages the related rows, rounded to something readable", () => {
    const [grand] = source.all("property");
    expect(grand!["rating"]).toBe(8.5);
    expect(grand!["reviews"]).toBe(2);
  });

  it("counts zero and rates null when nothing points at the row", () => {
    // A property with no reviews has no rating. Zero would sort it below the
    // worst-reviewed one, which is a lie about it.
    const coast = source.all("property").find((row) => row["id"] === "p3");
    expect(coast!["reviews"]).toBe(0);
    expect(coast!["rating"]).toBeNull();
  });

  it("can be sorted by, which is the whole reason it is a field", () => {
    const sorted = runQueryPage(
      source,
      { ...query, sort: { param: "sort", allow: ["price", "rating"], dir: "desc" } },
      { sort: "rating" },
    );
    expect(sorted.rows[0]!["name"]).toBe("The Grand");
  });
});

describe("facets", () => {
  it("counts each option across the other filters", () => {
    const rows = runQueryExcluding(source, query, {}, "city");
    const counts = new Map<string, number>();
    for (const row of rows)
      counts.set(String(row["city"]), (counts.get(String(row["city"])) ?? 0) + 1);

    expect(counts.get("Nairobi")).toBe(2);
    expect(counts.get("Mombasa")).toBe(1);
  });

  it("keeps the other options visible once one is chosen", () => {
    // The behaviour that makes a filter rail usable: picking Nairobi must not
    // make Mombasa read zero, or you can never switch.
    const rows = runQueryExcluding(source, query, { city: "Nairobi" }, "city");
    expect(rows.map((row) => row["city"])).toContain("Mombasa");
  });

  it("still applies the other filters to its counts", () => {
    const rows = runQueryExcluding(source, query, { max_price: "5000" }, "city");
    expect(rows).toHaveLength(1);
    expect(rows[0]!["name"]).toBe("Riverside Inn");
  });
});

describe("the page itself", () => {
  const render = (params: Record<string, string> = {}) =>
    renderPage(spec.pages[0]!, { spec, source: base, params, path: "/search" }).html;

  it("shows the count, the facet totals and a pager together", () => {
    const html = render();

    expect(html).toContain("3 properties");
    expect(html).toMatch(/Nairobi<\/a><span class="fx-facet-count">2/);
    expect(html).toContain("Page 1 of 2");
  });

  it("filters, and says so in every part of the page", () => {
    const html = render({ city: "Mombasa" });

    expect(html).toContain("1 property");
    expect(html).toContain("Coast House");
    expect(html).not.toContain("The Grand");
    // The facet keeps its own options, and offers a way back.
    expect(html).toContain("Clear");
  });

  it("drops the page number when a filter changes", () => {
    // Page 7 of the old filter is not page 7 of the new one, and an empty page
    // reads as "no results".
    const html = render({ page: "2" });
    expect(html).toMatch(/href="\/search\?city=Nairobi"/);
  });
});
