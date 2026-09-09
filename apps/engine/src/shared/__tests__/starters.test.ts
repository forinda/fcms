/**
 * Every starter has to be a spec the platform would accept (ADR 0036).
 *
 * A starter that fails validation fails it on somebody's first afternoon with
 * the product, on a screen that has just promised them a working site — so it
 * fails here instead. `checkReferences` matters as much as the schema: a form
 * naming a field that does not exist parses fine and renders nothing.
 */
import { describe, expect, it } from "vitest";
import { checkReferences, collectionType, SiteSpec, STARTERS, starterFor } from "@forinda-cms/spec";
import { CORE_BLOCKS } from "@forinda-cms/render";

describe.each(STARTERS.map((s) => [s.key, s] as const))("the %s starter", (_key, starter) => {
  const spec = SiteSpec.parse(starter.build("Riverside Salon"));

  it("is a valid spec, references and all", () => {
    expect(checkReferences(spec)).toEqual([]);
  });

  it("takes the site's name", () => {
    expect(spec.name).toBe("Riverside Salon");
  });

  it("has a front page, so the site answers at / from the first minute", () => {
    expect(spec.pages.some((p) => p.path === "/")).toBe(true);
  });

  it("only uses blocks the renderer has", () => {
    const seen = new Set<string>();
    const walk = (blocks: readonly { type: string; children?: unknown; item?: unknown }[]) => {
      for (const block of blocks) {
        seen.add(block.type);
        walk((block.children ?? []) as never);
        walk((block.item ?? []) as never);
      }
    };
    walk(spec.pages.flatMap((p) => p.blocks) as never);
    // The header and footer are blocks too, and a starter that used one the
    // renderer does not have would render the "unknown block" placeholder on
    // every page at once.
    walk([...(spec.layout?.header ?? []), ...(spec.layout?.footer ?? [])] as never);

    expect([...seen].filter((type) => !CORE_BLOCKS[type])).toEqual([]);
  });

  it("declares the theme tokens the stylesheet reads", () => {
    // ADR 0035: the renderer's own CSS reads these, and a starter missing one
    // hands somebody a site with a hard-coded fallback colour in it.
    for (const name of ["brand", "text", "muted", "background", "border"]) {
      expect(spec.theme.colors[name]).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(spec.theme.radius?.["md"]).toBeDefined();
  });

  it("says what it gives you", () => {
    expect(starter.summary.length).toBeGreaterThan(10);
    expect(starter.gives.length).toBeGreaterThan(0);
  });
});

describe("the starters as a set", () => {
  it("is addressable by key", () => {
    expect(starterFor("blank")?.label).toBe("Nothing yet");
    expect(starterFor("nothing-like-this")).toBeUndefined();
  });

  it("offers one that takes submissions from the public, and says so in the spec", () => {
    // A form on a page is not permission. The type has to declare it, which is
    // what makes opening a site to the world a change that shows in the diff.
    const spec = SiteSpec.parse(starterFor("enquiries")!.build("A site"));
    const enquiry = spec.content.find((t) => t.key === "enquiry")!;
    expect(enquiry.submissions).toBe("anyone");
  });

  it("binds nothing to a collection it does not define", () => {
    for (const starter of STARTERS) {
      const spec = SiteSpec.parse(starter.build("A site"));
      for (const page of spec.pages) {
        const bound = collectionType(page.collection);
        if (bound) expect(spec.content.map((t) => t.key)).toContain(bound);
      }
    }
  });
});
