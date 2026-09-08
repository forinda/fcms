/**
 * Adding, describing and removing a page (ADR 0035).
 *
 * The address is where the care goes: it is what a customer has bookmarked and
 * what search results point at, and it is the one field on this form that a
 * typo makes into a 404.
 */
import { describe, expect, it } from "vitest";
import { SiteSpec } from "@forinda-cms/spec";

import { ApplySpecUseCase } from "../use-cases/apply-spec.usecase";
import { PageManageUseCase } from "../use-cases/page-manage.usecase";

const spec = SiteSpec.parse({
  specVersion: 2,
  name: "Riverside Salon",
  theme: { colors: { brand: "#1a7f5a" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
  content: [
    { key: "service", label: "Service", fields: [{ name: "slug", label: "Slug", type: "text" }] },
  ],
  pages: [
    { key: "home", path: "/", title: "Home", blocks: [{ type: "heading", attrs: { text: "Hi" } }] },
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
  return { edits: new PageManageUseCase(apply), applied };
}

const INPUT = { actor: "owner@example.test", role: "owner" as const };
const pageIn = (s: SiteSpec, key: string) => s.pages.find((p) => p.key === key)!;

const settings = (over: Record<string, unknown> = {}) => ({
  title: "Home",
  path: "/",
  draft: false,
  ...over,
});

describe("adding a page", () => {
  it("starts empty, because the canvas is where blocks go", async () => {
    const { edits, applied } = editor();
    expect(await edits.create(spec, "about", "About us", "/about", INPUT)).toEqual({
      ok: true,
      seq: 1,
    });
    expect(pageIn(applied[0]!, "about").blocks).toEqual([]);
  });

  it("fixes an address rather than lecturing about one", async () => {
    const { edits, applied } = editor();
    // "About/" is what someone types. Refusing it with "absolute lowercase
    // path, no trailing slash" is a message written for the schema rather than
    // for the person holding the keyboard.
    await edits.create(spec, "about", "About us", "About/", INPUT);
    expect(pageIn(applied[0]!, "about").path).toBe("/about");
  });

  it("refuses what it cannot fix, and shows what was typed", async () => {
    const { edits } = editor();
    // A space is not a slug and guessing a hyphen would be inventing the
    // address rather than tidying it.
    const result = await edits.create(spec, "about", "About us", "/about us", INPUT);
    expect(result.ok === false && result.error).toContain("“/about us” is not an address");
  });

  it("refuses an address it cannot make sense of", async () => {
    const { edits, applied } = editor();
    const result = await edits.create(spec, "about", "About", "/about?x=1", INPUT);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("is not an address");
    expect(applied).toHaveLength(0);
  });

  it("refuses to put two pages at the same address", async () => {
    const { edits } = editor();
    expect(await edits.create(spec, "front", "Front", "/", INPUT)).toEqual({
      ok: false,
      error: "Something already answers /.",
    });
  });

  it("refuses a key that is taken", async () => {
    const { edits } = editor();
    expect(await edits.create(spec, "home", "Home again", "/again", INPUT)).toEqual({
      ok: false,
      error: 'There is already a page called "home".',
    });
  });
});

describe("describing a page", () => {
  it("keeps SEO absent rather than empty", async () => {
    const { edits, applied } = editor();
    await edits.update(spec, "home", settings({ seoTitle: "  ", seoDescription: "" }), INPUT);
    expect(pageIn(applied[0]!, "home").seo).toBeUndefined();
  });

  it("keeps a social image the form has no control for", async () => {
    const { edits, applied } = editor();
    const withImage = SiteSpec.parse({
      ...spec,
      pages: [{ ...spec.pages[0]!, seo: { image: "asset:0123abcd" } }],
    });

    await edits.update(withImage, "home", settings({ seoDescription: "Book with us" }), INPUT);
    const seo = pageIn(applied[0]!, "home").seo!;
    expect(seo.description).toBe("Book with us");
    // Set on the canvas, where the media library is. A form that rebuilt `seo`
    // from its own inputs would drop it and report success.
    expect(seo.image).toBe("asset:0123abcd");
  });

  it("refuses to bind a page to a type that does not exist", async () => {
    const { edits } = editor();
    expect(await edits.update(spec, "home", settings({ collection: "product" }), INPUT)).toEqual({
      ok: false,
      error: 'There is no type called "product".',
    });
  });

  it("turns a page into a draft without touching its blocks", async () => {
    const { edits, applied } = editor();
    await edits.update(spec, "home", settings({ draft: true }), INPUT);
    const page = pageIn(applied[0]!, "home");
    expect(page.draft).toBe(true);
    expect(page.blocks).toHaveLength(1);
  });
});

describe("removing a page", () => {
  it("goes, with its blocks", async () => {
    const { edits, applied } = editor();
    expect(await edits.remove(spec, "home", { ...INPUT, allowDestructive: true })).toEqual({
      ok: true,
      seq: 1,
    });
    expect(applied[0]!.pages).toEqual([]);
  });

  it("says so when it is already gone", async () => {
    const { edits } = editor();
    expect(await edits.remove(spec, "gone", INPUT)).toEqual({
      ok: false,
      error: "That page no longer exists.",
    });
  });
});
