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
  specVersion: 2,
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

describe("computed fields", () => {
  const withTotal = SiteSpec.parse({
    ...spec,
    content: [
      {
        ...spec.content[0]!,
        fields: [
          ...spec.content[0]!.fields,
          {
            name: "total",
            label: "Total",
            type: "computed",
            precision: 0,
            // Three nights at the nightly rate — the sentence a booking site
            // has to be able to say, and the one ADR 0001 forbids in a
            // template.
            formula: {
              op: "multiply",
              of: [{ field: "price" }, { param: "nights", default: 1 }],
            },
          },
          {
            name: "value",
            label: "Value for money",
            type: "computed",
            precision: 2,
            // Reads the aggregate the engine filled in on the same pass.
            formula: { op: "divide", of: [{ field: "rating" }, { field: "stars" }] },
          },
        ],
      },
      spec.content[1]!,
    ],
  });

  const rows = (params: Record<string, string> = {}) =>
    withDerived(withTotal, base, undefined, params).all("property");

  it("multiplies a field by a request parameter", () => {
    const [grand] = rows({ nights: "3" });
    expect(grand!["total"]).toBe(36000);
  });

  it("falls back to the declared default when nobody said how many", () => {
    const [grand] = rows();
    expect(grand!["total"]).toBe(12000);
  });

  it("can read a value the engine computed earlier in the same pass", () => {
    // `rating` is an aggregate; `value` divides it. Order is declaration order,
    // aggregates first — anything else would be an evaluation order to reason
    // about.
    const [grand] = rows();
    expect(grand!["value"]).toBe(1.7);
  });

  it("is null rather than zero when something it needs is missing", () => {
    // The property with no reviews has no rating, so it has no value-for-money
    // either. Zero would be a claim about it.
    const coast = rows().find((row) => row["id"] === "p3");
    expect(coast!["value"]).toBeNull();
  });

  it("is null rather than infinity when a denominator is zero", () => {
    const zeroStars = SiteSpec.parse({
      ...withTotal,
      content: [withTotal.content[0]!, withTotal.content[1]!],
    });
    const source_ = withDerived(
      zeroStars,
      staticSource({
        property: [{ id: "p9", name: "Unrated", city: "X", stars: 0, price: 100 }],
        review: [{ id: "r9", property: "p9", score: 8 }],
      }),
      undefined,
      {},
    );

    expect(source_.all("property")[0]!["value"]).toBeNull();
  });

  it("ignores a parameter that is not a number", () => {
    const [grand] = rows({ nights: "three" });
    expect(grand!["total"]).toBe(12000);
  });
});

/**
 * A detail page's lists are about the row the page is for.
 *
 * Without `{ entry: … }` there was no way to say that: a condition could name a
 * field of the row being filtered or a request parameter, and the page's own
 * entry was neither. Every property page therefore listed every room on the
 * site — a bug that reads as a design decision until somebody has two
 * properties, which is the first day of a marketplace.
 */
describe("a collection page filters by its own entry", () => {
  const twoProperties = SiteSpec.parse({
    specVersion: 2,
    name: "Stays",
    theme: { colors: { brand: "#003580" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
    content: [
      {
        key: "property",
        label: "Property",
        titleField: "name",
        fields: [{ name: "name", label: "Name", type: "text", required: true }],
      },
      {
        key: "room",
        label: "Room",
        titleField: "name",
        fields: [
          { name: "name", label: "Name", type: "text", required: true },
          { name: "property", label: "Property", type: "reference", to: "property" },
        ],
      },
    ],
    pages: [
      {
        key: "property-detail",
        path: "/stay",
        title: "{{ entry.name }}",
        collection: { from: "property" },
        blocks: [
          {
            type: "list",
            data: {
              from: "room",
              where: [{ field: "property", op: "eq", value: { entry: "slug" } }],
              limit: 10,
            },
            item: [{ type: "heading", attrs: { text: "{{ item.name }}", level: 2 } }],
          },
        ],
      },
    ],
  });

  const source = staticSource({
    property: [
      { slug: "harbour", name: "Harbour Hotel" },
      { slug: "hillside", name: "Hillside Lodge" },
    ],
    room: [
      { slug: "h-single", name: "Harbour single", property: "harbour" },
      { slug: "h-double", name: "Harbour double", property: "harbour" },
      { slug: "l-suite", name: "Hillside suite", property: "hillside" },
    ],
  });

  const page = twoProperties.pages[0]!;

  it("lists only that property's rooms", () => {
    const { html } = renderPage(
      page,
      { spec: twoProperties, source },
      {
        slug: "harbour",
        name: "Harbour Hotel",
      },
    );

    expect(html).toContain("Harbour single");
    expect(html).toContain("Harbour double");
    expect(html).not.toContain("Hillside suite");
  });

  it("accepts `slug` and `id`, which every row has and no type declares", () => {
    // The form that matches a written `ref:<type>/<slug>` reference, and so the
    // form a detail page normally uses. A check that only allowed declared
    // fields refused it.
    const withSlug = {
      ...JSON.parse(JSON.stringify(twoProperties)),
      pages: [
        {
          ...JSON.parse(JSON.stringify(twoProperties.pages[0])),
          blocks: [
            {
              type: "list",
              data: {
                from: "room",
                where: [{ field: "property", op: "eq", value: { entry: "id" } }],
                limit: 10,
              },
              item: [{ type: "heading", attrs: { text: "{{ item.name }}", level: 2 } }],
            },
          ],
        },
      ],
    };
    expect(() => SiteSpec.parse(withSlug)).not.toThrow();
  });

  it("lists nothing at all when the page has no entry", () => {
    // Not everything. "The rooms of this property" with no property is zero
    // rooms — the opposite failure to the one above, and the tempting one to
    // write, since an unresolved `param` correctly drops its condition.
    const { html } = renderPage(page, { spec: twoProperties, source });

    expect(html).not.toContain("Harbour single");
    expect(html).not.toContain("Hillside suite");
  });
});

/**
 * An aggregate has to find the rows that point at its row.
 *
 * A reference is written `ref:<type>/<slug>` — the spec says so, and every
 * authored file uses it. Aggregates matched only the parent's id, so a hotel's
 * guest score, its review count and its cheapest room were all empty on any
 * site whose content came from files rather than from the admin. That is the
 * site the CLI exists to make.
 */
describe("aggregates over a written reference", () => {
  const spec = SiteSpec.parse({
    specVersion: 2,
    name: "Stays",
    theme: { colors: { brand: "#003580" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
    content: [
      {
        key: "property",
        label: "Property",
        titleField: "name",
        fields: [
          { name: "name", label: "Name", type: "text", required: true },
          {
            name: "score",
            label: "Score",
            type: "aggregate",
            of: "review",
            on: "property",
            field: "score",
            fn: "avg",
          },
          {
            name: "reviewCount",
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
        titleField: "title",
        fields: [
          { name: "title", label: "Title", type: "text", required: true },
          { name: "score", label: "Score", type: "number", required: true },
          { name: "property", label: "Property", type: "reference", to: "property" },
        ],
      },
    ],
    pages: [],
  });

  it("counts rows that name it by slug, the way a file does", () => {
    const source = withDerived(
      spec,
      staticSource({
        property: [{ id: "p1", slug: "harbour", name: "The Harbour" }],
        review: [
          { id: "r1", slug: "r1", title: "Good", score: 9, property: "ref:property/harbour" },
          { id: "r2", slug: "r2", title: "Fine", score: 7, property: "ref:property/harbour" },
        ],
      }),
    );

    const [row] = source.all("property");
    expect(row?.["reviewCount"]).toBe(2);
    expect(row?.["score"]).toBe(8);
  });

  it("still counts rows that name it by id, the way the admin does", () => {
    const source = withDerived(
      spec,
      staticSource({
        property: [{ id: "p1", slug: "harbour", name: "The Harbour" }],
        review: [{ id: "r1", slug: "r1", title: "Good", score: 9, property: "p1" }],
      }),
    );

    expect(source.all("property")[0]?.["reviewCount"]).toBe(1);
  });

  it("does not count a review of another property", () => {
    const source = withDerived(
      spec,
      staticSource({
        property: [{ id: "p1", slug: "harbour", name: "The Harbour" }],
        review: [
          { id: "r1", slug: "r1", title: "Good", score: 9, property: "ref:property/hillside" },
        ],
      }),
    );

    expect(source.all("property")[0]?.["reviewCount"]).toBe(0);
  });
});

/**
 * Money is written the way the site says, not the way the renderer guesses.
 *
 * The renderer has always taken a locale and the engine never passed one, so a
 * hotel in Zanzibar priced itself in Kenyan shillings and the spec had no way
 * to disagree.
 */
describe("a site's own currency", () => {
  const priced = (currency: string, locale: string) =>
    SiteSpec.parse({
      specVersion: 2,
      name: "Stays",
      locale,
      currency,
      theme: { colors: { brand: "#003580" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
      content: [
        {
          key: "room",
          label: "Room",
          titleField: "name",
          fields: [
            { name: "name", label: "Name", type: "text", required: true },
            { name: "price", label: "Price", type: "number", required: true },
          ],
        },
      ],
      pages: [
        {
          key: "rooms",
          path: "/rooms",
          title: "Rooms",
          blocks: [
            {
              type: "list",
              data: { from: "room", limit: 5 },
              item: [{ type: "text", attrs: { text: "{{ item.price | currency }}" } }],
            },
          ],
        },
      ],
    });

  const source = staticSource({ room: [{ slug: "one", name: "One", price: 120 }] });

  it("defaults to what every existing site already renders", () => {
    const spec = SiteSpec.parse({
      specVersion: 2,
      name: "Stays",
      theme: { colors: { brand: "#003580" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
      content: [],
      pages: [],
    });
    expect(spec.currency).toBe("KES");
    expect(spec.locale).toBe("en-KE");
  });

  it("writes prices in the currency the spec declares", () => {
    const spec = priced("USD", "en-US");
    const { html } = renderPage(spec.pages[0]!, {
      spec,
      source,
      locale: { locale: spec.locale, currency: spec.currency },
    });
    expect(html).toContain("120");
    expect(html).not.toContain("Ksh");
  });
});

/**
 * A filter on a reference has to agree with an aggregate on the same reference.
 *
 * A reference field stores `ref:<type>/<slug>`. `{ entry: slug }` resolves to
 * the bare slug, so the only way the filter can be written matched nothing, and
 * a property page listed none of its own reviews while the card above it
 * counted four.
 */
describe("filtering on a reference", () => {
  const spec = SiteSpec.parse({
    specVersion: 2,
    name: "Stays",
    theme: { colors: { brand: "#003580" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
    content: [
      {
        key: "property",
        label: "Property",
        titleField: "name",
        fields: [{ name: "name", label: "Name", type: "text", required: true }],
      },
      {
        key: "review",
        label: "Review",
        titleField: "title",
        fields: [
          { name: "title", label: "Title", type: "text", required: true },
          { name: "property", label: "Property", type: "reference", to: "property" },
        ],
      },
    ],
    pages: [
      {
        key: "property-detail",
        path: "/stay",
        title: "{{ entry.name }}",
        collection: { from: "property" },
        blocks: [
          {
            type: "list",
            data: {
              from: "review",
              where: [{ field: "property", op: "eq", value: { entry: "slug" } }],
              limit: 10,
            },
            item: [{ type: "heading", attrs: { text: "{{ item.title }}", level: 3 } }],
          },
        ],
      },
    ],
  });

  const source = staticSource({
    property: [{ id: "p1", slug: "harbour", name: "The Harbour" }],
    review: [
      { id: "r1", slug: "r1", title: "Ours, written long", property: "ref:property/harbour" },
      { id: "r2", slug: "r2", title: "Ours, written short", property: "harbour" },
      { id: "r3", slug: "r3", title: "Somebody else's", property: "ref:property/hillside" },
    ],
  });

  it("matches a reference however it was written", () => {
    const { html } = renderPage(
      spec.pages[0]!,
      { spec, source },
      { slug: "harbour", name: "The Harbour" },
    );

    expect(html).toContain("Ours, written long");
    expect(html).toContain("Ours, written short");
    expect(html).not.toContain("Somebody else's");
  });
});

/**
 * The second list on a page is filtered too.
 *
 * A page's first query runs once before anything renders and is handed the
 * entry directly; every other query reads it off the walk. That field was
 * declared, read in three places, and never assigned — so a detail page's
 * *second* list showed nothing while its first looked correct. Every test had
 * one list, so every test passed.
 */
describe("a page with two lists", () => {
  const spec = SiteSpec.parse({
    specVersion: 2,
    name: "Stays",
    theme: { colors: { brand: "#003580" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
    content: [
      {
        key: "property",
        label: "Property",
        titleField: "name",
        fields: [{ name: "name", label: "Name", type: "text", required: true }],
      },
      {
        key: "review",
        label: "Review",
        titleField: "title",
        fields: [
          { name: "title", label: "Title", type: "text", required: true },
          { name: "property", label: "Property", type: "reference", to: "property" },
        ],
      },
      {
        key: "room",
        label: "Room",
        titleField: "name",
        fields: [
          { name: "name", label: "Name", type: "text", required: true },
          { name: "property", label: "Property", type: "reference", to: "property" },
        ],
      },
    ],
    pages: [
      {
        key: "property-detail",
        path: "/stay",
        title: "{{ entry.name }}",
        collection: { from: "property" },
        blocks: [
          {
            type: "list",
            data: {
              from: "room",
              where: [{ field: "property", op: "eq", value: { entry: "slug" } }],
              limit: 10,
            },
            item: [{ type: "heading", attrs: { text: "{{ item.name }}", level: 3 } }],
          },
          {
            type: "list",
            data: {
              from: "review",
              where: [{ field: "property", op: "eq", value: { entry: "slug" } }],
              limit: 10,
            },
            item: [{ type: "heading", attrs: { text: "{{ item.title }}", level: 3 } }],
          },
        ],
      },
    ],
  });

  const source = staticSource({
    property: [{ id: "p1", slug: "harbour", name: "The Harbour" }],
    room: [
      { id: "m1", slug: "m1", name: "Harbour single", property: "ref:property/harbour" },
      { id: "m2", slug: "m2", name: "Hillside suite", property: "ref:property/hillside" },
    ],
    review: [
      { id: "r1", slug: "r1", title: "Ours", property: "ref:property/harbour" },
      { id: "r2", slug: "r2", title: "Somebody else's", property: "ref:property/hillside" },
    ],
  });

  it("filters both of them by the page's entry", () => {
    const { html } = renderPage(
      spec.pages[0]!,
      { spec, source },
      { slug: "harbour", name: "The Harbour" },
    );

    expect(html).toContain("Harbour single");
    expect(html).toContain("Ours");
    expect(html).not.toContain("Hillside suite");
    expect(html).not.toContain("Somebody else's");
  });
});
