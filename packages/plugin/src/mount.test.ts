import { describe, expect, it } from "vitest";
import { CORE_BLOCKS, el, renderPage, staticSource } from "@forinda-cms/render";
import { SiteSpec } from "@forinda-cms/spec";

import { definePlugin, mountPlugins, type Plugin } from "./index.js";

const block = (name: string) => ({
  name,
  summary: "A test block.",
  attrs: ["label"],
  render: ({ className, attrs }: { className: string; attrs: Record<string, unknown> }) =>
    el("div", { class: className }, String(attrs.label ?? "")),
});

const bookings = (over: Partial<Record<string, unknown>> = {}, blocks = [block("acme-form")]) =>
  definePlugin({
    manifest: {
      name: "acme",
      version: "1.0.0",
      api: "1",
      provides: { blocks: blocks.map((b) => b.name) },
      ...over,
    },
    blocks,
  });

describe("definePlugin", () => {
  it("rejects a manifest that is wrong where it was written", () => {
    expect(() => definePlugin({ manifest: { name: "Acme", version: "1.0.0", api: "1" } })).toThrow(
      /kebab-case/,
    );
    expect(() => definePlugin({ manifest: { name: "acme", version: "v1", api: "1" } })).toThrow(
      /semver/,
    );
  });

  it("keeps a plugin's declared capabilities, unenforced but recorded", () => {
    const plugin = bookings({ capabilities: { network: ["api.acme.com"], secrets: ["ACME_KEY"] } });
    expect(plugin.manifest.capabilities).toEqual({
      network: ["api.acme.com"],
      secrets: ["ACME_KEY"],
    });
  });
});

describe("mountPlugins", () => {
  it("adds a plugin's blocks to the core registry", () => {
    const { registry, mounted, refused } = mountPlugins([bookings()]);
    expect(refused).toEqual([]);
    expect(mounted).toHaveLength(1);
    expect(registry["acme-form"]).toBeDefined();
    // Core is untouched — mounting returns a new map rather than mutating one.
    expect(Object.keys(CORE_BLOCKS)).not.toContain("acme-form");
  });

  it("refuses a block that is not namespaced to its plugin", () => {
    const { registry, refused } = mountPlugins([bookings({}, [block("form")])]);
    expect(refused[0]?.reason).toMatch(/namespaced/);
    // The core `form` block still means what it meant.
    expect(registry["form"]).toBe(CORE_BLOCKS["form"]);
  });

  it("refuses a block the manifest never declared, and a declaration with nothing behind it", () => {
    const undeclared: Plugin = {
      manifest: { ...bookings().manifest, provides: { blocks: [] } },
      blocks: [block("acme-form")],
    };
    expect(mountPlugins([undeclared]).refused[0]?.reason).toMatch(/not declared/);

    const empty: Plugin = { manifest: bookings().manifest, blocks: [] };
    expect(mountPlugins([empty]).refused[0]?.reason).toMatch(/nothing registers it/);
  });

  it("refuses an unsupported plugin API rather than half-loading it", () => {
    const { refused, registry } = mountPlugins([bookings({ api: "2" })]);
    expect(refused[0]?.reason).toMatch(/needs plugin API 2/);
    expect(registry["acme-form"]).toBeUndefined();
  });

  it("refuses two plugins that claim the same block", () => {
    const other = definePlugin({
      manifest: { name: "acme", version: "2.0.0", api: "1", provides: { blocks: ["acme-form"] } },
      blocks: [block("acme-form")],
    });
    const { mounted, refused } = mountPlugins([bookings(), other]);
    expect(mounted).toHaveLength(1);
    expect(refused[0]).toEqual({ plugin: "acme", reason: "already mounted" });
  });

  it("keeps mounting after a refusal — one bad plugin does not take the site down", () => {
    const good = definePlugin({
      manifest: { name: "beta", version: "1.0.0", api: "1", provides: { blocks: ["beta-hero"] } },
      blocks: [block("beta-hero")],
    });
    const { registry, refused } = mountPlugins([bookings({ api: "9" }), good]);
    expect(refused).toHaveLength(1);
    expect(registry["beta-hero"]).toBeDefined();
  });

  it("renders a mounted block through the ordinary renderer", () => {
    const { registry } = mountPlugins([bookings()]);
    const spec = SiteSpec.parse({
      specVersion: 2,
      name: "Test",
      theme: { colors: { brand: "#000000" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
      content: [],
      pages: [
        {
          key: "home",
          path: "/",
          title: "Home",
          blocks: [{ type: "acme-form", attrs: { label: "Book now" } }],
        },
      ],
    });

    const { html } = renderPage(spec.pages[0]!, { spec, source: staticSource({}), registry });
    expect(html).toContain("Book now");
  });
});
