/**
 * The theme (ADR 0035).
 *
 * Tier 1's promise is that changing a colour here changes it everywhere — which
 * is also why removing one is dangerous, and why "used in 3 places" has to be
 * true rather than approximately true.
 */
import { describe, expect, it } from "vitest";
import { SiteSpec } from "@forinda-cms/spec";

import { ApplySpecUseCase } from "../use-cases/apply-spec.usecase";
import { SiteEditUseCase, tokenUsage } from "../use-cases/site-edit.usecase";

const spec = SiteSpec.parse({
  specVersion: 2,
  name: "Riverside Salon",
  theme: {
    colors: { brand: "#1a7f5a", accent: "#c2410c", surface: "#ffffff" },
    fonts: { body: "Inter" },
    typeScale: { md: "1rem", xl: "2.5rem" },
    radius: { md: "8px", lg: "16px" },
  },
  content: [
    { key: "booking", label: "Booking", fields: [{ name: "ref", label: "Ref", type: "text" }] },
  ],
  pages: [
    {
      key: "home",
      path: "/",
      title: "Home",
      blocks: [
        {
          type: "section",
          style: { background: "token:color.surface", fontSize: "xl" },
          children: [{ type: "heading", attrs: { text: "Hello" }, style: { fontSize: "xl" } }],
        },
      ],
    },
  ],
  logic: [],
});

function editor() {
  const applied: SiteSpec[] = [];
  const apply = Object.assign(Object.create(ApplySpecUseCase.prototype) as ApplySpecUseCase, {
    execute: async (next: SiteSpec) => {
      applied.push(next);
      return { seq: applied.length, changes: [], migration: [] };
    },
  });
  return { edits: new SiteEditUseCase(apply), applied };
}

const INPUT = { actor: "owner@example.test" };

const settings = (over: Record<string, unknown> = {}) => ({
  name: "Riverside Salon",
  fonts: { body: "Inter" },
  tokens: {
    colors: { brand: "#1a7f5a", accent: "#c2410c", surface: "#ffffff" },
    typeScale: { md: "1rem", xl: "2.5rem" },
    radius: { md: "8px", lg: "16px" },
  },
  ...over,
});

describe("counting what uses a token", () => {
  it("counts colour references, which are always tokens", () => {
    expect(tokenUsage(spec, "colors", "surface")).toEqual({ count: 1, base: false });
    expect(tokenUsage(spec, "colors", "accent")).toEqual({ count: 0, base: false });
  });

  it("counts a size through the style prop that names it", () => {
    // A text search for "xl" would also match the radius scale and the theme.
    expect(tokenUsage(spec, "typeScale", "xl").count).toBe(2);
    expect(tokenUsage(spec, "typeScale", "md").count).toBe(0);
  });

  it("knows a radius can only be named by the stylesheet", () => {
    // `style.radius` is the tier-2 scale the renderer maps to fixed lengths,
    // not a reference into `theme.radius` — so a spec cannot name one.
    expect(tokenUsage(spec, "radius", "lg")).toEqual({ count: 0, base: false });
    expect(tokenUsage(spec, "radius", "md").base).toBe(true);
  });

  it("knows the site's own stylesheet reads some of them", () => {
    // `BASE_CSS` renders links with `var(--color-brand, #06c)`, so a `brand`
    // nobody names is still a `brand` whose removal turns every link blue.
    expect(tokenUsage(spec, "colors", "brand").base).toBe(true);
    expect(tokenUsage(spec, "radius", "md").base).toBe(true);
    expect(tokenUsage(spec, "colors", "accent").base).toBe(false);
  });
});

describe("removing a token", () => {
  it("refuses one the stylesheet itself reads", async () => {
    const { edits, applied } = editor();
    const result = await edits.removeToken(spec, "colors", "brand", INPUT);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("The site's own styles use");
    expect(applied).toHaveLength(0);
  });

  it("refuses one a page still names, and says how many", async () => {
    const { edits } = editor();
    const result = await edits.removeToken(spec, "colors", "surface", INPUT);
    expect(result.ok === false && result.error).toBe(
      "1 place still uses “surface”. Change it first.",
    );
  });

  it("removes one nothing points at", async () => {
    const { edits, applied } = editor();
    expect(await edits.removeToken(spec, "colors", "accent", INPUT)).toEqual({ ok: true, seq: 1 });
    expect(Object.keys(applied[0]!.theme.colors)).toEqual(["brand", "surface"]);
  });
});

describe("saving the settings", () => {
  it("writes new values for the tokens that exist", async () => {
    const { edits, applied } = editor();
    const result = await edits.update(
      spec,
      settings({ tokens: { ...settings().tokens, colors: { brand: "#1d8f66" } } }),
      INPUT,
    );

    expect(result).toEqual({ ok: true, seq: 1 });
    expect(applied[0]!.theme.colors["brand"]).toBe("#1d8f66");
    // Absent from the post is untouched, not deleted: a form that only rendered
    // some of the palette must not delete the rest of it.
    expect(applied[0]!.theme.colors["accent"]).toBe("#c2410c");
  });

  it("refuses something that is not a colour", async () => {
    const { edits, applied } = editor();
    const result = await edits.update(
      spec,
      settings({ tokens: { ...settings().tokens, colors: { brand: "dark green" } } }),
      INPUT,
    );
    expect(result).toEqual({ ok: false, error: "“brand” has to be a colour like #1a7f5a." });
    expect(applied).toHaveLength(0);
  });

  it("drops an optional font rather than storing an empty one", async () => {
    const { edits, applied } = editor();
    await edits.update(spec, settings({ fonts: { body: "Inter", heading: "  " } }), INPUT);
    expect(applied[0]!.theme.fonts.heading).toBeUndefined();
  });
});

describe("adding a token", () => {
  it("refuses a name that is not one", async () => {
    const { edits } = editor();
    expect(await edits.addToken(spec, "colors", "Brand Two", "#000000", INPUT)).toEqual({
      ok: false,
      error: "Use lowercase words joined by -.",
    });
  });

  it("refuses a colour that is not one", async () => {
    const { edits } = editor();
    expect(await edits.addToken(spec, "colors", "ink", "black", INPUT)).toEqual({
      ok: false,
      error: "A colour looks like #1a7f5a.",
    });
  });

  it("adds it where it was asked for", async () => {
    const { edits, applied } = editor();
    expect(await edits.addToken(spec, "radius", "xl", "24px", INPUT)).toEqual({ ok: true, seq: 1 });
    expect(applied[0]!.theme.radius?.["xl"]).toBe("24px");
  });
});
