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
  specVersion: 1,
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
    expect(await edits.move(spec, "home", [0], 1, INPUT)).toEqual({ ok: true, seq: 1 });

    expect(outline(applied[0]!)).toEqual([
      "section",
      "  text:Inside",
      "heading:One",
      "heading:Three",
    ]);
  });

  it("refuses to move the first block up, and applies nothing", async () => {
    const { edits, applied } = editor();
    const result = await edits.move(spec, "home", [0], -1, INPUT);

    expect(result).toEqual({ ok: false, error: "It is already at the end of its section." });
    expect(applied).toEqual([]);
  });

  it("leaves the caller's spec untouched when it refuses", async () => {
    // The canvas builds its next action on the spec it holds. A half-mutated
    // tree left behind by a refused edit is the state it must never be in.
    const { edits } = editor();
    const before = JSON.stringify(spec);
    await edits.move(spec, "home", [0], -1, INPUT);
    expect(JSON.stringify(spec)).toBe(before);
  });

  it("reports a page that is not there", async () => {
    const { edits } = editor();
    expect(await edits.move(spec, "nope", [0], 1, INPUT)).toEqual({
      ok: false,
      error: 'No page named "nope".',
    });
  });
});

describe("nesting", () => {
  it("moves a block into the one above it", async () => {
    const { edits, applied } = editor();
    expect((await edits.nest(spec, "home", [2], INPUT)).ok).toBe(true);

    expect(outline(applied[0]!)).toEqual([
      "heading:One",
      "section",
      "  text:Inside",
      "  heading:Three",
    ]);
  });

  it("refuses at the top of a list, where there is nothing to nest into", async () => {
    const { edits } = editor();
    expect((await edits.nest(spec, "home", [0], INPUT)).ok).toBe(false);
  });

  it("moves a nested block back out, after its old parent", async () => {
    const { edits, applied } = editor();
    expect((await edits.unnest(spec, "home", [1, 0], INPUT)).ok).toBe(true);

    expect(outline(applied[0]!)).toEqual([
      "heading:One",
      "section",
      "text:Inside",
      "heading:Three",
    ]);
  });

  it("refuses to unnest something already at the top level", async () => {
    const { edits } = editor();
    expect((await edits.unnest(spec, "home", [0], INPUT)).ok).toBe(false);
  });
});

describe("adding and removing", () => {
  it("adds after the selection", async () => {
    const { edits, applied } = editor();
    expect((await edits.add(spec, "home", [0], "text", INPUT)).ok).toBe(true);
    expect(outline(applied[0]!)[1]).toBe("text");
  });

  it("adds at the end when nothing is selected", async () => {
    const { edits, applied } = editor();
    expect((await edits.add(spec, "home", null, "divider", INPUT)).ok).toBe(true);
    expect(outline(applied[0]!).at(-1)).toBe("divider");
  });

  it("duplicates a block and everything inside it", async () => {
    const { edits, applied } = editor();
    expect((await edits.duplicate(spec, "home", [1], INPUT)).ok).toBe(true);

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
    expect((await edits.remove(spec, "home", [1], INPUT)).ok).toBe(true);
    expect(outline(applied[0]!)).toEqual(["heading:One", "heading:Three"]);
  });

  it("reports a stale path rather than editing the wrong block", async () => {
    // The canvas holds a path from the last render; a concurrent change can
    // make it point at nothing. Editing "whatever is there now" would be worse
    // than failing.
    const { edits, applied } = editor();
    expect((await edits.remove(spec, "home", [9], INPUT)).ok).toBe(false);
    expect(applied).toEqual([]);
  });
});

describe("editing text on the page", () => {
  it("changes only the words, keeping the rest of the block", async () => {
    const { edits, applied } = editor();
    await edits.setText(spec, "home", [0], "First", INPUT);

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
    await edits.setText(withButton, "home", [0], "Book now", INPUT);

    expect(applied[0]!.pages[0]!.blocks[0]!.attrs).toEqual({ label: "Book now", to: "/book" });
  });
});

describe("dragging", () => {
  it("moves a block several places in one edit", async () => {
    // One patch, not five: dragging is a single decision and undo should treat
    // it as one.
    const { edits, applied } = editor();
    await edits.reorder(spec, "home", [0], 2, INPUT);

    expect(outline(applied[0]!)).toEqual([
      "section",
      "  text:Inside",
      "heading:Three",
      "heading:One",
    ]);
  });

  it("clamps a drop past the end rather than losing the block", async () => {
    const { edits, applied } = editor();
    await edits.reorder(spec, "home", [0], 99, INPUT);
    expect(outline(applied[0]!).at(-1)).toBe("heading:One");
  });

  it("does nothing when a block is dropped where it already is", async () => {
    const { edits, applied } = editor();
    expect((await edits.reorder(spec, "home", [1], 1, INPUT)).ok).toBe(true);
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
    await edits.restyle(spec, "home", [0], { attrs: { text: "New" } }, INPUT);

    expect(applied[0]!.pages[0]!.blocks[0]!.attrs).toEqual({ text: "New" });
  });

  it("drops an empty set instead of writing an empty object", async () => {
    const { edits, applied } = editor();
    await edits.restyle(spec, "home", [0], { attrs: {}, style: {} }, INPUT);

    expect(applied[0]!.pages[0]!.blocks[0]!.attrs).toBeUndefined();
    expect(applied[0]!.pages[0]!.blocks[0]!.style).toBeUndefined();
  });

  it("refuses a change the spec rejects, without applying it", async () => {
    const { edits, applied } = editor();
    const result = await edits.restyle(
      spec,
      "home",
      [0],
      { style: { padding: "enormous" } },
      INPUT,
    );

    expect(result.ok).toBe(false);
    expect(applied).toEqual([]);
  });
});
