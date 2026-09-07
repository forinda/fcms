/**
 * Tree surgery, without a database.
 *
 * `ApplySpecUseCase` is stubbed, so these check the part that is this file's
 * own: what each action does to the block tree, what it refuses, and that a
 * refused edit leaves the caller's spec untouched. What happens *after* — the
 * diff, the gate, the patch — is tested where it lives.
 */
import { describe, expect, it } from "vitest";
import { SiteSpec, type Block } from "@forinda-cms/spec";

import { ApplySpecUseCase } from "../use-cases/apply-spec.usecase";
import { PageEditUseCase } from "../use-cases/page-edit.usecase";

const spec = SiteSpec.parse({
  specVersion: 2,
  name: "Riverside Salon",
  theme: { colors: { brand: "#1a7f5a" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
  content: [],
  pages: [
    {
      key: "home",
      path: "/",
      title: "Home",
      blocks: [
        { type: "heading", attrs: { text: "One" } },
        { type: "section", children: [{ type: "text", attrs: { text: "Inside" } }] },
        { type: "heading", attrs: { text: "Three" } },
      ],
    },
  ],
});

/** Captures what would have been applied, and reports success. */
function editor() {
  const applied: SiteSpec[] = [];
  const apply = Object.assign(Object.create(ApplySpecUseCase.prototype) as ApplySpecUseCase, {
    execute: async (next: SiteSpec) => {
      applied.push(next);
      return { seq: applied.length, changes: [], migration: [] };
    },
  });
  return { edits: new PageEditUseCase(apply), applied };
}

const INPUT = { actor: "owner@example.test" };

/** The tree that was applied, as `type:text` lines — readable in a failure. */
function outline(spec_: SiteSpec, depth = 0, blocks?: readonly Block[]): string[] {
  const list = blocks ?? spec_.pages[0]!.blocks;
  return list.flatMap((block) => {
    const attrs = (block.attrs ?? {}) as Record<string, unknown>;
    const label = typeof attrs["text"] === "string" ? `:${attrs["text"]}` : "";
    return [
      `${"  ".repeat(depth)}${block.type}${label}`,
      ...outline(spec_, depth + 1, block.children ?? []),
    ];
  });
}

describe("moving a block", () => {
  it("swaps it with its sibling", async () => {
    const { edits, applied } = editor();
    expect(await edits.move(spec, { page: "home" }, [0], 1, INPUT)).toEqual({ ok: true, seq: 1 });

    expect(outline(applied[0]!)).toEqual([
      "section",
      "  text:Inside",
      "heading:One",
      "heading:Three",
    ]);
  });

  it("refuses to move the first block up, and applies nothing", async () => {
    const { edits, applied } = editor();
    const result = await edits.move(spec, { page: "home" }, [0], -1, INPUT);

    expect(result).toEqual({ ok: false, error: "It is already at the end of its section." });
    expect(applied).toEqual([]);
  });

  it("leaves the caller's spec untouched when it refuses", async () => {
    // The canvas builds its next action on the spec it holds. A half-mutated
    // tree left behind by a refused edit is the state it must never be in.
    const { edits } = editor();
    const before = JSON.stringify(spec);
    await edits.move(spec, { page: "home" }, [0], -1, INPUT);
    expect(JSON.stringify(spec)).toBe(before);
  });

  it("reports a page that is not there", async () => {
    const { edits } = editor();
    expect(await edits.move(spec, { page: "nope" }, [0], 1, INPUT)).toEqual({
      ok: false,
      error: 'No page named "nope".',
    });
  });
});

describe("nesting", () => {
  it("moves a block into the one above it", async () => {
    const { edits, applied } = editor();
    expect((await edits.nest(spec, { page: "home" }, [2], INPUT)).ok).toBe(true);

    expect(outline(applied[0]!)).toEqual([
      "heading:One",
      "section",
      "  text:Inside",
      "  heading:Three",
    ]);
  });

  it("refuses at the top of a list, where there is nothing to nest into", async () => {
    const { edits } = editor();
    expect((await edits.nest(spec, { page: "home" }, [0], INPUT)).ok).toBe(false);
  });

  it("moves a nested block back out, after its old parent", async () => {
    const { edits, applied } = editor();
    expect((await edits.unnest(spec, { page: "home" }, [1, 0], INPUT)).ok).toBe(true);

    expect(outline(applied[0]!)).toEqual([
      "heading:One",
      "section",
      "text:Inside",
      "heading:Three",
    ]);
  });

  it("refuses to unnest something already at the top level", async () => {
    const { edits } = editor();
    expect((await edits.unnest(spec, { page: "home" }, [0], INPUT)).ok).toBe(false);
  });
});

describe("adding and removing", () => {
  it("adds after the selection", async () => {
    const { edits, applied } = editor();
    expect((await edits.add(spec, { page: "home" }, [0], "text", INPUT)).ok).toBe(true);
    expect(outline(applied[0]!)[1]).toBe("text");
  });

  it("adds at the end when nothing is selected", async () => {
    const { edits, applied } = editor();
    expect((await edits.add(spec, { page: "home" }, null, "divider", INPUT)).ok).toBe(true);
    expect(outline(applied[0]!).at(-1)).toBe("divider");
  });

  it("duplicates a block and everything inside it", async () => {
    const { edits, applied } = editor();
    expect((await edits.duplicate(spec, { page: "home" }, [1], INPUT)).ok).toBe(true);

    expect(outline(applied[0]!)).toEqual([
      "heading:One",
      "section",
      "  text:Inside",
      "section",
      "  text:Inside",
      "heading:Three",
    ]);
  });

  it("removes a block with its subtree", async () => {
    const { edits, applied } = editor();
    expect((await edits.remove(spec, { page: "home" }, [1], INPUT)).ok).toBe(true);
    expect(outline(applied[0]!)).toEqual(["heading:One", "heading:Three"]);
  });

  it("reports a stale path rather than editing the wrong block", async () => {
    // The canvas holds a path from the last render; a concurrent change can
    // make it point at nothing. Editing "whatever is there now" would be worse
    // than failing.
    const { edits, applied } = editor();
    expect((await edits.remove(spec, { page: "home" }, [9], INPUT)).ok).toBe(false);
    expect(applied).toEqual([]);
  });
});

describe("editing text on the page", () => {
  it("changes only the words, keeping the rest of the block", async () => {
    const { edits, applied } = editor();
    await edits.setText(spec, { page: "home" }, [0], "First", INPUT);

    // A double-click sends text and nothing else. Replacing the whole attribute
    // set would drop a heading's `level` and a button's `to` — a data loss the
    // editor would never mention.
    expect(applied[0]!.pages[0]!.blocks[0]!.attrs).toEqual({ text: "First" });
  });

  it("writes to the attribute the block actually uses for its words", async () => {
    const withButton = SiteSpec.parse({
      ...spec,
      pages: [
        {
          ...spec.pages[0]!,
          blocks: [{ type: "button", attrs: { label: "Book", to: "/book" } }],
        },
      ],
    });

    const { edits, applied } = editor();
    await edits.setText(withButton, { page: "home" }, [0], "Book now", INPUT);

    expect(applied[0]!.pages[0]!.blocks[0]!.attrs).toEqual({ label: "Book now", to: "/book" });
  });
});

describe("dragging", () => {
  it("moves a block several places in one edit", async () => {
    // One patch, not five: dragging is a single decision and undo should treat
    // it as one.
    const { edits, applied } = editor();
    await edits.reorder(spec, { page: "home" }, [0], 2, INPUT);

    expect(outline(applied[0]!)).toEqual([
      "section",
      "  text:Inside",
      "heading:Three",
      "heading:One",
    ]);
  });

  it("clamps a drop past the end rather than losing the block", async () => {
    const { edits, applied } = editor();
    await edits.reorder(spec, { page: "home" }, [0], 99, INPUT);
    expect(outline(applied[0]!).at(-1)).toBe("heading:One");
  });

  it("does nothing when a block is dropped where it already is", async () => {
    const { edits, applied } = editor();
    expect((await edits.reorder(spec, { page: "home" }, [1], 1, INPUT)).ok).toBe(true);
    // Still applied — the caller asked — but the tree is unchanged, so the diff
    // reports no change and no patch says "No visible change".
    expect(outline(applied[0]!)).toEqual(outline(spec));
  });
});

describe("the inspector's save", () => {
  it("replaces attributes rather than merging them", async () => {
    // The form submits every field it shows, so a merge would make clearing a
    // value impossible — the user deletes the text, and it comes back.
    const { edits, applied } = editor();
    await edits.restyle(spec, { page: "home" }, [0], { attrs: { text: "New" } }, INPUT);

    expect(applied[0]!.pages[0]!.blocks[0]!.attrs).toEqual({ text: "New" });
  });

  it("drops an empty set instead of writing an empty object", async () => {
    const { edits, applied } = editor();
    await edits.restyle(spec, { page: "home" }, [0], { attrs: {}, style: {} }, INPUT);

    expect(applied[0]!.pages[0]!.blocks[0]!.attrs).toBeUndefined();
    expect(applied[0]!.pages[0]!.blocks[0]!.style).toBeUndefined();
  });

  it("refuses a change the spec rejects, without applying it", async () => {
    const { edits, applied } = editor();
    const result = await edits.restyle(
      spec,
      { page: "home" },
      [0],
      { style: { padding: "enormous" } },
      INPUT,
    );

    expect(result.ok).toBe(false);
    expect(applied).toEqual([]);
  });
});

/**
 * Components (ADR 0022).
 *
 * The interesting cases are all about the promise a component makes: the page
 * it came from still renders the same thing, editing it reaches every page, and
 * the one-level rule holds even when someone tries to nest by extraction.
 */
describe("components", () => {
  it("lifts a section out and leaves an instance in its place", async () => {
    const { edits, applied } = editor();

    expect(
      await edits.saveAsComponent(spec, { page: "home" }, [1], "Call to action", INPUT),
    ).toEqual({ ok: true, seq: 1 });

    const next = applied[0]!;
    expect(next.components).toHaveLength(1);
    expect(next.components[0]!.key).toBe("call-to-action");
    expect(next.components[0]!.label).toBe("Call to action");
    // What was lifted is what the component holds — the page renders the same.
    expect(next.components[0]!.blocks).toEqual([spec.pages[0]!.blocks[1]]);
    expect(next.pages[0]!.blocks[1]).toEqual({
      type: "component",
      attrs: { use: "call-to-action" },
    });
  });

  it("refuses a name that is already taken, and one with nothing in it", async () => {
    const { edits } = editor();
    const withOne = SiteSpec.parse({
      ...spec,
      components: [{ key: "call-to-action", label: "Call to action", blocks: [{ type: "text" }] }],
    });

    expect(
      await edits.saveAsComponent(withOne, { page: "home" }, [1], "Call to action", INPUT),
    ).toEqual({ ok: false, error: 'There is already a component called "Call to action".' });
    expect(await edits.saveAsComponent(spec, { page: "home" }, [1], "   ", INPUT)).toEqual({
      ok: false,
      error: "Give the component a name.",
    });
  });

  it("refuses to lift a section that already places a component", async () => {
    const { edits } = editor();
    const nested = SiteSpec.parse({
      ...spec,
      components: [{ key: "cta", label: "CTA", blocks: [{ type: "text" }] }],
      pages: [
        {
          ...spec.pages[0]!,
          blocks: [{ type: "section", children: [{ type: "component", attrs: { use: "cta" } }] }],
        },
      ],
    });

    const result = await edits.saveAsComponent(nested, { page: "home" }, [0], "Wrapper", INPUT);
    expect(result).toEqual({
      ok: false,
      error: "That section places another component. Components are one level deep.",
    });
  });

  it("edits a component's own tree, and nothing else", async () => {
    const { edits, applied } = editor();
    const withOne = SiteSpec.parse({
      ...spec,
      components: [
        {
          key: "cta",
          label: "CTA",
          blocks: [{ type: "heading", attrs: { text: "Old" } }, { type: "button" }],
        },
      ],
    });

    expect(await edits.setText(withOne, { component: "cta" }, [0], "New", INPUT)).toEqual({
      ok: true,
      seq: 1,
    });
    expect(applied[0]!.components[0]!.blocks[0]!.attrs).toEqual({ text: "New" });
    expect(applied[0]!.pages).toEqual(withOne.pages);
  });

  it("says which component is missing rather than editing the wrong tree", async () => {
    const { edits, applied } = editor();
    expect(await edits.move(spec, { component: "nope" }, [0], 1, INPUT)).toEqual({
      ok: false,
      error: 'No component named "nope".',
    });
    expect(applied).toHaveLength(0);
  });

  it("refuses an instance placed inside a component", async () => {
    const { edits } = editor();
    const withOne = SiteSpec.parse({
      ...spec,
      components: [
        { key: "cta", label: "CTA", blocks: [{ type: "text" }] },
        { key: "band", label: "Band", blocks: [{ type: "section" }] },
      ],
    });

    const result = await edits.add(withOne, { component: "band" }, [0], "component", INPUT, {
      use: "cta",
    });
    expect(result).toEqual({
      ok: false,
      error:
        'component "band" places component "cta" — components are one level deep, so copy what it holds instead',
    });
  });
});
