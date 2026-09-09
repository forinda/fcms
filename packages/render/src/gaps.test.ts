/**
 * The gaps a real site hit, and what closes each one.
 *
 * Every case here comes from building the footer, header and information pages
 * of the reference marketplace: things the blocks could not say, worked around
 * in the site's own YAML until they were fixed here instead.
 */
import { describe, expect, it } from "vitest";
import { SiteSpec } from "@forinda-cms/spec";

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
