/**
 * The gaps a real site hit, and what closes each one.
 *
 * Every case here comes from building the footer, header and information pages
 * of the reference marketplace: things the blocks could not say, worked around
 * in the site's own YAML until they were fixed here instead.
 */
import { describe, expect, it } from "vitest";
import { SiteSpec } from "@forinda-cms/spec";

import { llmsTxt } from "./agents.js";
import { blockCss, scopedCss } from "./css.js";
import { statusHtml } from "./status.js";
import { renderPage } from "./render.js";
import { staticSource, withDerived } from "./entries.js";

const spec = SiteSpec.parse({
  specVersion: 2,
  name: "Stays",
  locale: "en-US",
  currency: "USD",
  theme: { colors: { brand: "#003580" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
  content: [
    {
      key: "city",
      label: "City",
      titleField: "name",
      fields: [{ name: "name", label: "Name", type: "text", required: true }],
    },
    {
      key: "property",
      label: "Property",
      titleField: "name",
      fields: [
        { name: "name", label: "Name", type: "text", required: true },
        { name: "photo", label: "Photo", type: "asset", accept: "image" },
        { name: "city", label: "City", type: "reference", to: "city", filterable: true },
        { name: "stars", label: "Stars", type: "number", filterable: true },
        {
          name: "kind",
          label: "Type",
          type: "select",
          filterable: true,
          options: [
            { value: "hotel", label: "Hotel" },
            { value: "villa", label: "Villa" },
          ],
        },
      ],
    },
    {
      key: "enquiry",
      label: "Enquiry",
      titleField: "subject",
      submissions: "anyone",
      fields: [
        {
          name: "subject",
          label: "Subject",
          type: "select",
          required: true,
          options: [
            { value: "booking", label: "About a booking" },
            { value: "listing", label: "Listing a property" },
          ],
        },
        { name: "body", label: "Message", type: "richtext", help: "What can we help with?" },
      ],
    },
  ],
  pages: [
    {
      key: "search",
      path: "/search",
      title: "Search",
      blocks: [
        { type: "facets", attrs: { for: "property", field: "kind", title: "Type" } },
        { type: "facets", attrs: { for: "property", field: "city", title: "City" } },
        {
          type: "facets",
          attrs: { for: "property", field: "stars", title: "Stars", order: "value" },
        },
        {
          type: "nav",
          id: "footer-nav",
          attrs: { label: "Footer", links: [{ label: "Help", to: "/help" }] },
        },
        { type: "form", attrs: { for: "enquiry", submitLabel: "Send" } },
        {
          type: "list",
          data: { from: "property", limit: 10 },
          item: [
            {
              type: "image",
              when: { field: "item.photo", op: "exists" },
              attrs: { src: "{{ item.photo }}" },
            },
            {
              type: "text",
              attrs: { text: "{{ item.stars }} {{ item.stars | plural: star, stars }}" },
            },
          ],
        },
      ],
    },
  ],
});

const source = withDerived(
  spec,
  staticSource({
    city: [{ id: "c1", slug: "nairobi", name: "Nairobi" }],
    property: [
      {
        id: "p1",
        slug: "harbour",
        name: "Harbour",
        city: "ref:city/nairobi",
        stars: 4,
        kind: "hotel",
        photo: "asset:abc123",
      },
      { id: "p2", slug: "hill", name: "Hill", city: "ref:city/nairobi", stars: 1, kind: "villa" },
    ],
    enquiry: [],
  }),
);

const html = renderPage(spec.pages[0]!, {
  spec,
  source,
  locale: { locale: spec.locale, currency: spec.currency },
}).html;

describe("what a facet shows", () => {
  it("uses a select's own label, not its stored value", () => {
    expect(html).toContain(">Hotel<");
    expect(html).not.toContain(">hotel<");
  });

  it("resolves a reference to the title of the row it points at", () => {
    // `ref:city/nairobi` in a filter rail is showing somebody the storage
    // format.
    expect(html).toContain(">Nairobi<");
    expect(html).not.toContain("ref:city/nairobi<");
  });

  it("can be ordered by value rather than by count", () => {
    // A star rating read 4, 3, 1, 2, 5 — the order of popularity, for a scale.
    const rail = html.slice(html.indexOf("Stars"));
    expect(rail.indexOf(">1<")).toBeLessThan(rail.indexOf(">4<"));
  });
});

describe("what a block can say", () => {
  it("names its own landmark", () => {
    // Six navs all announced "Main navigation" is worse than none of them.
    expect(html).toContain('aria-label="Footer"');
  });

  it("carries an anchor, so a link can reach it", () => {
    expect(html).toContain('id="footer-nav"');
  });
});

describe("a generated form", () => {
  it("renders a select as a select", () => {
    // It rendered a free-text box for a closed set of choices, and then the
    // schema refused whatever was typed.
    expect(html).toContain('<select id="f-subject"');
    expect(html).toContain('<option value="booking">About a booking</option>');
  });

  it("uses the field's help as placeholder text, beside the label and not instead of it", () => {
    expect(html).toContain('placeholder="What can we help with?"');
    expect(html).toContain('<label for="f-body">Message</label>');
  });
});

describe("emptiness and plurals", () => {
  it("hides a block for a row with no value, rather than rendering an empty src", () => {
    // `{ op: ne, value: "" }` is true for null, so this rendered `<img src="">`
    // for every row without a photo.
    expect(html.match(/<img/g) ?? []).toHaveLength(1);
    expect(html).not.toContain('src=""');
  });

  it("says one star and four stars", () => {
    expect(html).toContain("1 star<");
    expect(html).toContain("4 stars<");
  });
});

/**
 * What a crawler and a share preview are told.
 *
 * Compared against a hand-written site's own SEO helper, which emits a dozen
 * tags this did not — and, more importantly, turned up two that were wrong
 * rather than missing.
 */
describe("the head of a page", () => {
  const collection = SiteSpec.parse({
    specVersion: 2,
    name: "Stays",
    locale: "sw-TZ",
    currency: "TZS",
    theme: { colors: { brand: "#003580" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
    content: [
      {
        key: "property",
        label: "Property",
        titleField: "name",
        fields: [{ name: "name", label: "Name", type: "text", required: true }],
      },
    ],
    pages: [
      {
        key: "property-detail",
        path: "/stay",
        title: "{{ entry.name }}",
        collection: { from: "property" },
        seo: { description: "A place to stay" },
        blocks: [{ type: "heading", attrs: { text: "{{ entry.name }}", level: 1 } }],
      },
    ],
  });

  const rows = staticSource({
    property: [
      { id: "p1", slug: "harbour", name: "The Harbour" },
      { id: "p2", slug: "hill", name: "Hill House" },
    ],
  });

  const at = (path: string, entryRow: Record<string, unknown>) =>
    renderPage(
      collection.pages[0]!,
      { spec: collection, source: rows, canonicalBase: "https://stays.example", path },
      entryRow,
    ).html;

  it("canonicalises each entry to its own address", () => {
    // Every entry page said its canonical version was `/stay` — the tag for
    // "this is a duplicate of that", pointed at a page that is not this one.
    expect(at("/stay/harbour", { slug: "harbour", name: "The Harbour" })).toContain(
      'rel="canonical" href="https://stays.example/stay/harbour"',
    );
    expect(at("/stay/hill", { slug: "hill", name: "Hill House" })).toContain(
      'href="https://stays.example/stay/hill"',
    );
  });

  it("declares the site's own language", () => {
    // A screen reader picks its voice from this, and it said English on a
    // Swahili site because the attribute was written out by hand.
    expect(at("/stay/harbour", { slug: "harbour", name: "The Harbour" })).toContain('lang="sw-TZ"');
  });

  it("tells a share preview which address it is, and in what language", () => {
    const html = at("/stay/harbour", { slug: "harbour", name: "The Harbour" });
    expect(html).toContain('property="og:url" content="https://stays.example/stay/harbour"');
    expect(html).toContain('property="og:locale" content="sw_TZ"');
    expect(html).toContain('property="og:type" content="article"');
    expect(html).toContain('name="twitter:title"');
    expect(html).toContain('name="twitter:description"');
  });
});

describe("what a site publishes to machines", () => {
  const base = {
    specVersion: 2,
    name: "Stays",
    note: "Rooms\nby the harbour.",
    theme: { colors: { brand: "#003580" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
    content: [
      {
        key: "property",
        label: "Property",
        labelPlural: "Properties",
        titleField: "name",
        fields: [
          { name: "name", label: "Name", type: "text", required: true },
          { name: "city", label: "City", type: "text" },
        ],
      },
    ],
    pages: [
      {
        key: "property-detail",
        path: "/stay",
        title: "{{ entry.name }}",
        collection: { from: "property" },
        blocks: [{ type: "heading", attrs: { text: "{{ entry.name }}", level: 1 } }],
      },
      { key: "home", path: "/", title: "Home", note: "The front page", blocks: [] },
      { key: "wip", path: "/wip", title: "Half done", draft: true, blocks: [] },
      { key: "thanks", path: "/thanks", title: "Thanks", seo: { noindex: true }, blocks: [] },
    ],
  };

  it("describes the site for something reading rather than crawling", () => {
    const text = llmsTxt(SiteSpec.parse(base), "https://stays.example/");

    expect(text).toContain("# Stays");
    // A note is prose and may wrap; a summary line may not.
    expect(text).toContain("> Rooms by the harbour.");
    expect(text).toContain("- [Home](https://stays.example/): The front page");
    // A collection page's title is a template with no row to resolve against,
    // so it is named by what it lists.
    expect(text).toContain("- [Properties](https://stays.example/stay): every Property");
    expect(text).toContain("- **Properties** — name, city");
  });

  it("leaves out the pages a crawler is not shown either", () => {
    const text = llmsTxt(SiteSpec.parse(base));
    expect(text).not.toContain("/wip");
    expect(text).not.toContain("/thanks");
  });

  it("carries an analytics tag only when the site asked for one", () => {
    const off = SiteSpec.parse(base);
    const page = (spec: typeof off) =>
      renderPage(spec.pages[1]!, { spec, source: staticSource({}) }).html;

    expect(page(off)).not.toContain("googletagmanager");

    const on = SiteSpec.parse({ ...base, analytics: { gtag: "G-ABC1234567" } });
    expect(page(on)).toContain('src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"');
    expect(page(on)).toContain("gtag('config','G-ABC1234567')");
  });

  it("refuses a measurement id that is really a script", () => {
    expect(() =>
      SiteSpec.parse({ ...base, analytics: { gtag: "G-1'></script><script>alert(1)</script>" } }),
    ).toThrow();
  });
});

describe("the style system's pressure valves", () => {
  it("keeps block CSS inside the block, whatever the author types", () => {
    // This used to be `.cls{` + the author's text + `}`, so a `}` in the middle
    // closed the rule and the rest applied to the whole page — tier 3's
    // boundary was a promise the emitter did not keep.
    const out = scopedCss("b0", "color:red} body{display:none").join("");
    expect(out).not.toContain("body{display:none}");
    expect(out).not.toContain("} body");
  });

  it("lets a block reach its own internals, and nothing else", () => {
    const out = scopedCss(
      "b0",
      "display:flex; ul { list-style: none; gap: 1rem } &:hover { opacity: .9 }",
    ).join("");

    expect(out).toContain(".b0{display:flex}");
    // A block author never writes a selector, so the class is prefixed for them
    // — which is what makes a nested one safe.
    expect(out).toContain(".b0 ul{list-style: none;gap: 1rem}");
    expect(out).toContain(".b0:hover{opacity: .9}");
  });

  it("drops a second level rather than emitting it half-scoped", () => {
    const out = scopedCss("b0", "ul { color: red; li { color: blue } }").join("");
    expect(out).toContain(".b0 ul{color: red}");
    expect(out).not.toContain("blue");
  });

  it("measures a band's children without narrowing the band", () => {
    // A section constrained by `width` constrains its background too, so every
    // full-bleed band needed a wrapper block inside it, on every page.
    const css = blockCss("b0", { contentWidth: "container" }, undefined);
    expect(css).toContain(".b0>*{max-width:72rem;margin-inline:auto;width:100%}");
    expect(css).not.toContain(".b0{max-width");
  });

  it("emits a class for a variant the block declares, and only then", () => {
    const spec = SiteSpec.parse({
      specVersion: 2,
      name: "Stays",
      theme: { colors: { brand: "#003580" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
      content: [
        {
          key: "note",
          label: "Note",
          fields: [{ name: "name", label: "Name", type: "text", required: true }],
        },
      ],
      pages: [
        {
          key: "home",
          path: "/",
          title: "Home",
          blocks: [
            { type: "button", attrs: { text: "Book", to: "/book" }, style: { variant: "outline" } },
            { type: "button", attrs: { text: "Call", to: "/call" }, style: { variant: "ghost" } },
          ],
        },
      ],
    });

    const { html } = renderPage(spec.pages[0]!, { spec, source: staticSource({}) });
    expect(html).toContain("fx-variant-outline");
    // `ghost` is not one of the button's declared variants: ignored rather than
    // styled by accident.
    expect(html).not.toContain("fx-variant-ghost");
  });
});

describe("a filter names itself", () => {
  const spec = SiteSpec.parse({
    specVersion: 2,
    name: "Help",
    theme: { colors: { brand: "#003580" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
    content: [
      {
        key: "article",
        label: "Article",
        titleField: "title",
        fields: [{ name: "title", label: "Title", type: "text", required: true }],
      },
    ],
    pages: [
      {
        key: "help",
        path: "/help",
        title: "Help centre",
        blocks: [
          {
            type: "filters",
            attrs: { for: "article" },
            data: {
              from: "article",
              where: [
                {
                  field: "title",
                  op: "contains",
                  value: { param: "q", label: "Search help", placeholder: "How do I cancel?" },
                },
              ],
              limit: 10,
            },
            item: [{ type: "text", attrs: { text: "{{ item.title }}" } }],
          },
        ],
      },
    ],
  });

  it("uses the clause's own words rather than the field's", () => {
    // The help centre's search box was labelled "Title", because that is the
    // name of the column it happens to filter.
    const { html } = renderPage(spec.pages[0]!, {
      spec,
      source: staticSource({ article: [{ id: "a1", slug: "cancel", title: "Cancelling" }] }),
    });

    expect(html).toContain(">Search help</label>");
    expect(html).toContain('placeholder="How do I cancel?"');
    expect(html).not.toContain(">Title</label>");
  });
});

describe("a step that asks rather than offers", () => {
  const spec = SiteSpec.parse({
    specVersion: 2,
    name: "Stays",
    theme: { colors: { brand: "#003580" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
    content: [
      {
        key: "room",
        label: "Room",
        titleField: "name",
        fields: [{ name: "name", label: "Name", type: "text", required: true }],
      },
    ],
    pages: [
      {
        key: "book",
        path: "/book",
        title: "Book",
        blocks: [],
        flows: [
          {
            key: "booking",
            steps: [
              {
                key: "dates",
                label: "Your dates",
                captures: ["check_in", "check_out"],
                blocks: [{ type: "text", attrs: { text: "When are you coming?" } }],
              },
              {
                key: "room",
                label: "Your room",
                selects: { from: "room", as: "room" },
                blocks: [
                  {
                    type: "list",
                    data: { from: "room", limit: 10 },
                    item: [{ type: "card", attrs: { heading: "{{ item.name }}" } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  const source = staticSource({ room: [{ id: "r1", slug: "double", name: "Double" }] });

  it("offers no way on until it has what it asked for", () => {
    // A Continue that continues to the same screen is worse than no button.
    const { html } = renderPage(spec.pages[0]!, {
      spec,
      source,
      params: { check_in: "2026-09-11" },
    });
    // The stylesheet names the class on every page, so this asks about the form.
    expect(html).not.toContain('action="/flow/book/booking/dates"');
  });

  it("posts what it collected once it has all of it", () => {
    // The whole gap: a first screen that only collects dates could not be
    // answered at all, so a booking journey had to start at step two.
    const { html } = renderPage(spec.pages[0]!, {
      spec,
      source,
      params: { check_in: "2026-09-11", check_out: "2026-09-13" },
    });

    expect(html).toContain('action="/flow/book/booking/dates"');
    expect(html).toContain('name="check_in" value="2026-09-11"');
    expect(html).toContain('name="check_out" value="2026-09-13"');
  });

  it("summarises a captured step in words rather than an empty colon", () => {
    const { html } = renderPage(spec.pages[0]!, { spec, source }, undefined);
    expect(html).toBeTruthy();

    const answered = renderPage(spec.pages[0]!, {
      spec,
      source,
      flow: { dates: { check_in: "2026-09-11", check_out: "2026-09-13" } },
    });
    expect(answered.html).toContain("Your dates: 2026-09-11 – 2026-09-13");
  });

  it("refuses a step that both selects and captures", () => {
    expect(() =>
      SiteSpec.parse({
        ...JSON.parse(JSON.stringify(spec)),
        pages: [
          {
            key: "book",
            path: "/book",
            title: "Book",
            blocks: [],
            flows: [
              {
                key: "booking",
                steps: [
                  {
                    key: "both",
                    captures: ["check_in"],
                    selects: { from: "room", as: "room" },
                    blocks: [{ type: "text", attrs: { text: "?" } }],
                  },
                  { key: "later", blocks: [{ type: "text", attrs: { text: "?" } }] },
                ],
              },
            ],
          },
        ],
      }),
    ).toThrow(/one way/);
  });
});

describe("a server that cannot reach its own site", () => {
  it("still answers a page rather than a stack trace", () => {
    // A 500 is usually the database being unreachable, and the spec lives in
    // the database — so this one reads nothing.
    const html = statusHtml(500, "Riverside Rooms");
    expect(html).toContain("Something went wrong at our end");
    expect(html).toContain("Riverside Rooms");
    expect(html).toContain('name="robots" content="noindex,nofollow"');
  });
});
