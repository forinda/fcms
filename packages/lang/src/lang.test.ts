/**
 * The profile is the language. These tests are the profile.
 *
 * ADR 0006 says rules 1, 2 and 4 are what make this a *profile* rather than "we
 * use YAML" — a parser that accepts them has accepted a different language. So
 * the anchor/alias/merge cases below are not edge cases, they are the boundary.
 */
import { describe, expect, it } from "vitest";

import { formatDiagnostic } from "./errors.js";
import { joinFiles, splitFiles } from "./layout.js";
import { COLLECTION_SECTIONS } from "@forinda-cms/spec";

import { parseSpec } from "./parse.js";
import { formatSource, printSpec } from "./print.js";

const SITE = `
specVersion: 1
name: Test Salon
note: Fixture for the language tests. Exercises every site-level section on
  purpose — a round-trip test is only as strong as its fixture, and this one
  silently passed while \`fmt\` was deleting layouts.
layout:
  header:
    - type: nav
      attrs: { links: [{ label: Home, to: / }] }
  footer:
    - type: footer
      attrs: { text: "© Test Salon" }
theme:
  colors: { brand: "#1a7f5a", surface: "#f5f5f4" }
  fonts: { body: Inter }
  typeScale: { sm: 0.875rem, md: 1rem }
content:
  - key: service
    label: Service
    titleField: name
    fields:
      - { name: name, label: Name, type: text }
      - { name: active, label: Active, type: boolean, filterable: true }
pages:
  - key: home
    path: /
    title: Home
    blocks:
      - type: list
        data:
          from: service
          where:
            - { field: active, op: eq, value: true }
          limit: 12
        item:
          - type: card
            attrs: { heading: "{{ item.name }}" }
logic:
  - key: notify
    trigger: { on: entry.created, type: service }
    steps:
      - { action: email-send }
`;

describe("the strict profile (ADR 0006)", () => {
  it("parses a valid spec", () => {
    const r = parseSpec(SITE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec.content[0]!.key).toBe("service");
  });

  it("rejects anchors and aliases — the route by which config grows variables", () => {
    const withAnchor = SITE.replace(
      'colors: { brand: "#1a7f5a", surface: "#f5f5f4" }',
      'colors: &c { brand: "#1a7f5a", surface: "#f5f5f4" }',
    );
    const r = parseSpec(withAnchor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics[0]!.message).toMatch(/anchors/);
  });

  it("rejects merge keys", () => {
    const r = parseSpec(SITE.replace("  - key: service\n", "  - <<: {}\n    key: service\n"));
    expect(r.ok).toBe(false);
  });

  it("rejects a second document in one file", () => {
    const r = parseSpec(`${SITE}\n---\nspecVersion: 1\n`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics[0]!.message).toMatch(/multiple YAML documents/);
  });

  it("rejects duplicate keys rather than taking the last", () => {
    const r = parseSpec(SITE.replace("name: Test Salon", "name: Test Salon\nname: Other Salon"));
    expect(r.ok).toBe(false);
  });

  it("reads 1.2 core types — `no` stays a string, not false", () => {
    const r = parseSpec(SITE.replace("name: Test Salon", "name: no"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec.name).toBe("no");
  });
});

describe("diagnostics carry a position (the ADR 0006 budget)", () => {
  it("points at the line of a schema failure", () => {
    const r = parseSpec(SITE.replace("          limit: 12\n", ""));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const d = r.diagnostics[0]!;
      expect(d.path).toContain("data");
      // Located by walking up to the nearest existing ancestor, since a missing
      // key has no node of its own.
      expect(d.line).toBeGreaterThan(0);
    }
  });

  // Not a parse error — YAML reads `{{ x }}` as a flow mapping and silently
  // produces `{ "x": null }`. Wrong data, no complaint. Caught in the profile.
  it("rejects an unquoted template rather than silently making it a map", () => {
    const r = parseSpec(
      SITE.replace(
        'attrs: { heading: "{{ item.name }}" }',
        "attrs:\n              heading: {{ item.name }}",
      ),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const d = r.diagnostics[0]!;
      expect(d.message).toMatch(/must be quoted/);
      expect(d.hint).toMatch(/flow mapping/);
      expect(d.line).toBeGreaterThan(0);
    }
  });

  it("names the file and line when formatted", () => {
    const out = formatDiagnostic({
      path: "/pages/0",
      message: "boom",
      line: 3,
      col: 5,
      file: "pages/home.yaml",
      hint: "try this",
    });
    expect(out).toContain("pages/home.yaml:3:5");
    expect(out).toContain("hint: try this");
  });

  it("reports a cross-file reference error, not a shape error", () => {
    const r = parseSpec(SITE.replace("from: service", "from: treatment"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics[0]!.message).toMatch(/treatment/);
  });
});

describe("the canonical printer (ADR 0006 rules 5 and 6)", () => {
  const spec = (() => {
    const r = parseSpec(SITE);
    if (!r.ok) throw new Error("fixture must parse");
    return r.spec;
  })();

  it("quotes any string containing a template, unconditionally", () => {
    expect(printSpec(spec)).toContain('"{{ item.name }}"');
  });

  it("orders keys by schema, not alphabetically", () => {
    const text = printSpec(spec);
    // `type` precedes `data` precedes `item` — reading order, not A-Z, which
    // would put `attrs` first and `children` in the middle.
    expect(text.indexOf("type: list")).toBeLessThan(text.indexOf("from: service"));
    expect(text.indexOf("specVersion")).toBeLessThan(text.indexOf("name:"));
  });

  it("is idempotent — the property `pull` depends on", () => {
    const once = printSpec(spec);
    const twice = formatSource(once);
    expect(twice.ok).toBe(true);
    if (twice.ok) expect(twice.text).toBe(once);
  });

  it("round-trips meaning", () => {
    const reparsed = parseSpec(printSpec(spec));
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok) expect(reparsed.spec).toEqual(spec);
  });
});

describe("the derived file layout", () => {
  const spec = (() => {
    const r = parseSpec(SITE);
    if (!r.ok) throw new Error("fixture must parse");
    return r.spec;
  })();

  it("emits one file per content type, page and workflow", () => {
    const files = splitFiles(spec);
    expect(Object.keys(files).sort()).toEqual([
      "content/service.yaml",
      "logic/notify.yaml",
      "pages/home.yaml",
      "site.yaml",
    ]);
  });

  /**
   * The test that would have caught `fmt` deleting a site's header.
   *
   * Written as "nothing is lost", not "these fields survive" — a test listing
   * fields would have been updated alongside the splitter and passed while the
   * bug shipped. The point is that it fails for a field nobody has thought
   * about yet.
   *
   * That only works if the fixture carries every site-level section. The first
   * version of this test passed against the broken splitter because `SITE` had
   * no `layout` to lose, which is the same class of mistake one level up.
   */
  it("loses nothing on the way out and back", () => {
    const joined = joinFiles(splitFiles(spec));
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.spec).toEqual(spec);
  });

  it("carries site-level sections other than content, pages and logic", () => {
    // `layout` and `note` were added by ADR 0014 and silently dropped by a
    // hand-written field list. Assert on the file itself, so a regression shows
    // up where it happens rather than three steps downstream.
    const withLayout = { ...spec, layout: { header: [{ type: "nav" as const }] } };
    const site = splitFiles(withLayout as typeof spec)["site.yaml"]!;
    expect(site).toContain("layout");
    expect(site).toContain("nav");
  });

  it("rejoins into the same spec", () => {
    const joined = joinFiles(splitFiles(spec));
    expect(joined.ok).toBe(true);
    if (joined.ok) expect(joined.spec).toEqual(spec);
  });

  it("validates cross-file references only after joining", () => {
    const files = { ...splitFiles(spec) };
    files["pages/home.yaml"] = files["pages/home.yaml"]!.replace(
      "from: service",
      "from: treatment",
    );
    const joined = joinFiles(files);
    expect(joined.ok).toBe(false);
    if (!joined.ok) expect(joined.diagnostics[0]!.message).toMatch(/treatment/);
  });

  /**
   * The guard the last fix should have come with.
   *
   * Splitting and rejoining is only lossless while the writer and every reader
   * agree on which sections get their own files. Fixing `splitFiles` and leaving
   * `joinFiles` — and two project loaders — with their own copies of the list
   * would have turned a misplacement bug into a data-loss one: files written and
   * never read back.
   *
   * Asserts the agreement directly, rather than trusting a fixture to happen to
   * contain every section.
   */
  it("writes a file for every declared collection section, and reads them all back", () => {
    const files = splitFiles(spec);
    for (const section of COLLECTION_SECTIONS) {
      const entries = (spec as unknown as Record<string, unknown[]>)[section] ?? [];
      const written = Object.keys(files).filter((f) => f.startsWith(`${section}/`));
      // An empty section writing no files is correct; the count check below
      // covers it either way.
      expect(written.length, `${section} wrote no files`).toBe(entries.length);
    }

    const joined = joinFiles(files);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    for (const section of COLLECTION_SECTIONS) {
      const before = (spec as unknown as Record<string, unknown[]>)[section]!;
      const after = (joined.spec as unknown as Record<string, unknown[]>)[section]!;
      expect(after.length, `${section} lost entries on the round trip`).toBe(before.length);
    }
  });

  it("says which file is missing", () => {
    const joined = joinFiles({ "pages/home.yaml": "key: home" });
    expect(joined.ok).toBe(false);
    if (!joined.ok) expect(joined.diagnostics[0]!.message).toMatch(/site\.yaml/);
  });
});
