/**
 * Renderer tests.
 *
 * The escaping and injection cases are the ones that matter most: a `data` query
 * renders rows written by site visitors, so unescaped output is stored XSS by
 * construction rather than by mistake (doc 05).
 */
import { describe, expect, it } from "vitest";
import { SiteSpec } from "@forinda-cms/spec";

import { CORE_BLOCKS } from "./blocks.js";
import { blockCss, themeCss } from "./css.js";
import { esc } from "./html.js";
import { renderPage, routes } from "./render.js";
import { runQuery, staticSource } from "./entries.js";
import { resolve } from "./scope.js";

const spec = SiteSpec.parse({
  specVersion: 2,
  name: "Test Salon",
  theme: {
    colors: { brand: "#1a7f5a", surface: "#f5f5f4" },
    fonts: { body: "Inter" },
    typeScale: { sm: "0.875rem", md: "1rem" },
  },
  content: [
    {
      key: "service",
      label: "Service",
      titleField: "name",
      jsonld: { type: "Service", properties: { name: "name", description: "blurb" } },
      fields: [
        { name: "name", label: "Name", type: "text" },
        { name: "blurb", label: "Blurb", type: "text" },
        { name: "price", label: "Price", type: "number" },
        { name: "active", label: "Active", type: "boolean", filterable: true },
      ],
    },
  ],
  pages: [
    {
      key: "home",
      path: "/",
      title: "Home",
      blocks: [
        {
          type: "heading",
          attrs: { text: "Book with us", level: 1 },
          style: { padding: "lg", textColor: "token:color.brand" },
        },
        {
          type: "list",
          style: { cols: { base: 1, md: 3 }, gap: "md" },
          data: {
            from: "service",
            where: [{ field: "active", op: "eq", value: true }],
            sort: { field: "name", dir: "asc" },
            limit: 12,
          },
          item: [
            {
              type: "card",
              attrs: { heading: "{{ item.name }}", body: "{{ item.price | currency }}" },
            },
          ],
        },
      ],
    },
    {
      key: "service-detail",
      path: "/services",
      title: "Service",
      collection: "service",
      blocks: [{ type: "heading", attrs: { text: "{{ entry.name }}" } }],
    },
  ],
});

const source = staticSource({
  service: [
    { id: "2", slug: "colour", name: "Colour", blurb: "Full colour", price: 3500, active: true },
    { id: "1", slug: "cut", name: "Cut", blurb: "A haircut", price: 1200, active: true },
    { id: "3", slug: "old", name: "Retired", price: 0, active: false },
  ],
});

const home = spec.pages[0]!;
const detail = spec.pages[1]!;

describe("output is escaped by default (doc 05)", () => {
  it("escapes entry content coming from a query", () => {
    const hostile = staticSource({
      service: [{ id: "x", slug: "x", name: "<script>alert(1)</script>", price: 1, active: true }],
    });
    const { html } = renderPage(home, { spec, source: hostile });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes the title and meta description", () => {
    expect(esc('a "b" <c>')).toBe("a &quot;b&quot; &lt;c&gt;");
  });

  it("drops event-handler attributes and javascript: URLs", () => {
    const page = {
      ...home,
      blocks: [
        { type: "button", attrs: { label: "x", to: "javascript:alert(1)", onclick: "alert(1)" } },
      ],
    } as typeof home;
    const { html } = renderPage(page, { spec, source });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("onclick");
  });

  it("escapes `</script>` inside JSON-LD", () => {
    const nasty = staticSource({
      service: [
        { id: "1", slug: "a", name: "</script><img src=x onerror=alert(1)>", active: true },
      ],
    });
    const { html } = renderPage(detail, { spec, source: nasty }, nasty.all("service")[0]);
    expect(html).not.toContain("</script><img");
    expect(html).toContain("\\u003c");
  });
});

describe("queries (ADR 0009 §1)", () => {
  it("filters, sorts and limits", () => {
    const rows = runQuery(source, {
      from: "service",
      where: [{ field: "active", op: "eq", value: true }],
      sort: { field: "name", dir: "asc" },
      limit: 12,
    });
    expect(rows.map((r) => r["name"])).toEqual(["Colour", "Cut"]);
  });

  it("applies the limit", () => {
    expect(runQuery(source, { from: "service", limit: 1 }).length).toBe(1);
  });

  it("renders one item template per row", () => {
    const { html } = renderPage(home, { spec, source });
    expect(html).toContain("Colour");
    expect(html).toContain("Cut");
    expect(html).not.toContain("Retired");
  });

  it("is total when a field does not exist rather than throwing", () => {
    expect(() =>
      runQuery(source, {
        from: "service",
        where: [{ field: "nope", op: "eq", value: 1 }],
        limit: 5,
      }),
    ).not.toThrow();
  });
});

describe("templates resolve in scope (ADR 0001)", () => {
  it("reads item.* inside a data block and applies a formatter", () => {
    const { html } = renderPage(home, { spec, source });
    expect(html).toMatch(/1,200/);
  });

  it("formats currency in the configured locale, not a hardcoded one", () => {
    const kenyan = renderPage(home, { spec, source }).html;
    const british = renderPage(home, {
      spec,
      source,
      locale: { locale: "en-GB", currency: "GBP" },
    }).html;
    expect(kenyan).toContain("Ksh");
    expect(british).toContain("£");
  });

  it("leaves an unresolvable path empty rather than printing braces", () => {
    expect(resolve("{{ item.missing }}", { item: {} })).toBe("");
  });
});

describe("`when` gates a subtree", () => {
  it("omits a block whose condition fails", () => {
    const page = {
      ...home,
      blocks: [
        {
          type: "heading",
          attrs: { text: "Hidden" },
          when: { field: "site.name", op: "eq", value: "Other" },
        },
      ],
    } as typeof home;
    expect(renderPage(page, { spec, source }).html).not.toContain("Hidden");
  });

  it("keeps a block whose condition holds", () => {
    const page = {
      ...home,
      blocks: [
        {
          type: "heading",
          attrs: { text: "Shown" },
          when: { field: "site.name", op: "eq", value: "Test Salon" },
        },
      ],
    } as typeof home;
    expect(renderPage(page, { spec, source }).html).toContain("Shown");
  });
});

describe("styling stays token-valued (ADR 0004)", () => {
  it("emits theme tokens as custom properties", () => {
    expect(themeCss(spec.theme)).toContain("--color-brand: #1a7f5a");
  });

  it("compiles a token reference to var(), never a literal", () => {
    const css = blockCss("b0", { textColor: "token:color.brand" } as never);
    expect(css).toContain("var(--color-brand)");
    expect(css).not.toContain("#1a7f5a");
  });

  it("emits responsive cols as a media query", () => {
    const css = blockCss("b1", { cols: { base: 1, md: 3 } } as never);
    expect(css).toContain("repeat(1, minmax(0, 1fr))");
    expect(css).toContain("@media (min-width:768px)");
  });
});

describe("SEO comes from the content model (doc 08)", () => {
  it("generates JSON-LD from the type mapping without per-entry config", () => {
    const entry = source.all("service")[1]!;
    const { html } = renderPage(detail, { spec, source }, entry);
    expect(html).toContain('"@type":"Service"');
    expect(html).toContain('"name":"Cut"');
    expect(html).toContain('"description":"A haircut"');
  });

  it("marks a draft page noindex regardless of its own setting", () => {
    const { html } = renderPage({ ...home, draft: true }, { spec, source });
    expect(html).toContain("noindex");
  });

  it("always emits a mobile viewport", () => {
    expect(renderPage(home, { spec, source }).html).toContain("width=device-width");
  });
});

describe("routing", () => {
  it("expands a collection page into one route per entry", () => {
    const paths = routes(spec, source).map((r) => r.path);
    expect(paths).toContain("/");
    expect(paths).toContain("/services/cut");
    expect(paths).toContain("/services/old");
  });
});

describe("unknown blocks are named, not hidden (ADR 0001)", () => {
  it("renders a visible placeholder", () => {
    const page = { ...home, blocks: [{ type: "carousel" }] } as typeof home;
    const { html } = renderPage(page, { spec, source });
    expect(html).toContain("Unknown block type");
    expect(html).toContain("carousel");
  });
});

describe("determinism", () => {
  it("renders byte-identical output for the same input", () => {
    const a = renderPage(home, { spec, source }).html;
    const b = renderPage(home, { spec, source }).html;
    expect(a).toBe(b);
  });

  it("every core block declares a summary and attrs for the AI to enumerate", () => {
    for (const [name, block] of Object.entries(CORE_BLOCKS)) {
      expect(block.summary, name).toBeTruthy();
      expect(Array.isArray(block.attrs), name).toBe(true);
    }
  });

  it("keeps a draft page off the public site, and shows it in a preview", () => {
    // `draft` sat in the schema from the first version and nothing read it, so
    // an unpublished page was served exactly like a published one.
    const withDraft = SiteSpec.parse({
      ...spec,
      pages: [
        ...spec.pages,
        { key: "secret", path: "/secret", title: "Secret", draft: true, blocks: [] },
      ],
    });

    const paths = (drafts: boolean) =>
      routes(withDraft, source, { drafts }).map((route) => route.path);

    expect(paths(false)).not.toContain("/secret");
    expect(paths(true)).toContain("/secret");
  });
});

describe("components (ADR 0022)", () => {
  const withComponent = SiteSpec.parse({
    ...spec,
    components: [
      {
        key: "cta",
        label: "Call to action",
        blocks: [
          { type: "heading", attrs: { text: "Book today" } },
          { type: "button", attrs: { label: "Book", to: "/book" } },
        ],
      },
    ],
    pages: [
      {
        key: "twice",
        path: "/twice",
        title: "Twice",
        blocks: [
          { type: "component", attrs: { use: "cta" } },
          { type: "text", attrs: { text: "Between" } },
          { type: "component", attrs: { use: "cta" } },
        ],
      },
    ],
  });

  it("renders a component's blocks where it is placed, every time it is placed", () => {
    const { html } = renderPage(withComponent.pages[0]!, { spec: withComponent, source });
    expect(html.split("Book today")).toHaveLength(3);
    expect(html.indexOf("Between")).toBeGreaterThan(html.indexOf("Book today"));
  });

  it("says so rather than rendering nothing when the component is missing", () => {
    const broken = { ...withComponent, components: [] } as typeof withComponent;
    const { html } = renderPage(broken.pages[0]!, { spec: broken, source });
    expect(html).toContain("cta");
  });
});

describe("a collection page's own title", () => {
  const withEntryTitle = SiteSpec.parse({
    ...spec,
    pages: [
      {
        key: "service-detail",
        path: "/services",
        title: "{{ entry.name }}",
        collection: { from: "service" },
        blocks: [{ type: "heading", attrs: { text: "{{ entry.name }}" } }],
      },
    ],
  });

  it("resolves against the entry, like every other template", () => {
    // It did not, so every entry page on every site shared one `<title>`
    // reading `{{ entry.name }} — Riverside Rooms`, while the `<h1>` beside it
    // was correct. Doc 08 makes the title most of what a crawler reads.
    const entry = source.all("service")[0]!;
    const { html, title } = renderPage(
      withEntryTitle.pages[0]!,
      { spec: withEntryTitle, source },
      entry,
    );

    expect(title).toBe(`${String(entry["name"])} — Test Salon`);
    expect(html).not.toContain("{{ entry.name }}");
  });
});
