/**
 * The canvas: a tree, the real page, and a generated inspector.
 *
 * ADR 0017 §2 — the middle pane is an iframe of the actual rendered page, same
 * renderer and same CSS, so there is no fidelity gap to manage. §5 — every
 * action here is a form that posts and re-renders, and the JavaScript at the
 * bottom only adds selection and highlighting on top of that. A canvas whose
 * only input is a mouse drag excludes keyboard and touch users from the
 * product's headline feature.
 */
import type { Block, Page, SiteSpec } from "@forinda-cms/spec";
import type { BlockType } from "@forinda-cms/render";

import { esc } from "./view";

export interface CanvasOptions {
  readonly spec: SiteSpec;
  readonly page: Page;
  readonly registry: Record<string, BlockType>;
  readonly selected: readonly number[] | null;
  readonly inspector: string;
  readonly previewUrl: string;
  readonly error?: string | undefined;
}

/** One row per block, indented by depth — the structure, as structure. */
function tree(
  blocks: readonly Block[],
  registry: Record<string, BlockType>,
  selected: string,
  path: readonly number[] = [],
): string {
  return blocks
    .map((block, index) => {
      const here = [...path, index];
      const id = here.join("-");
      const known = registry[block.type];
      const children = block.children ?? block.item ?? [];

      const label = summarise(block, known);
      const repeats = block.data ? '<span class="pill">repeats</span>' : "";

      return `<li>
  <div class="node${id === selected ? " selected" : ""}">
    <a href="?block=${esc(id)}">${esc(label)}</a>${repeats}
    <span class="node-actions">
      <button form="act" name="op" value="up:${esc(id)}" title="Move up">↑</button>
      <button form="act" name="op" value="down:${esc(id)}" title="Move down">↓</button>
      <button form="act" name="op" value="nest:${esc(id)}" title="Nest into the block above">→</button>
      <button form="act" name="op" value="unnest:${esc(id)}" title="Move out">←</button>
      <button form="act" name="op" value="dup:${esc(id)}" title="Duplicate">⧉</button>
      <button form="act" name="op" value="del:${esc(id)}" title="Delete" class="destructive">✕</button>
    </span>
  </div>
  ${children.length > 0 ? `<ul>${tree(children, registry, selected, block.data ? [...here, 0] : here)}</ul>` : ""}
</li>`;
    })
    .join("\n");
}

/**
 * What a block is, in the owner's words.
 *
 * The block's own text where it has some, its type otherwise — a tree of
 * fifteen rows all reading "text" is a tree nobody can navigate.
 */
function summarise(block: Block, type: BlockType | undefined): string {
  const attrs = (block.attrs ?? {}) as Record<string, unknown>;
  for (const key of ["text", "label", "title", "heading"]) {
    const value = attrs[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.length > 40 ? `${value.slice(0, 40)}…` : value;
    }
  }
  return type ? type.name : `${block.type} (unknown)`;
}

export function canvas(options: CanvasOptions): string {
  const { page, registry, selected, inspector, previewUrl, error } = options;
  const selectedId = selected ? selected.join("-") : "";

  const palette = Object.values(registry)
    .filter((type) => !type.name.startsWith("field"))
    .map(
      (type) =>
        `<option value="${esc(type.name)}">${esc(type.name)} — ${esc(type.summary)}</option>`,
    )
    .join("");

  return `${error ? `<p class="error">${esc(error)}</p>` : ""}
<div class="canvas">
  <aside class="tree">
    <h2>${esc(page.title)}</h2>
    <p class="help">${esc(page.path)}</p>
    <ul class="blocks">${tree(page.blocks, registry, selectedId)}</ul>

    <form method="post" id="act" class="add">
      <input type="hidden" name="block" value="${esc(selectedId)}">
      <label for="add-type">Add a block</label>
      <div class="row">
        <select id="add-type" name="type">${palette}</select>
        <button name="op" value="add" type="submit">Add</button>
      </div>
      <p class="help">Added after the selected block, or at the end.</p>
    </form>
  </aside>

  <div class="preview">
    <iframe src="${esc(previewUrl)}" title="${esc(page.title)}" id="page"></iframe>
  </div>

  <aside class="panel">
    ${selected ? inspector : '<p class="help">Select a block to edit it.</p>'}
  </aside>
</div>

<script>
// Selection only. Everything above works with this file absent (ADR 0017 §5);
// this makes clicking the page select the block, which is what people try first.
(() => {
  const frame = document.getElementById("page");
  if (!frame) return;

  frame.addEventListener("load", () => {
    const doc = frame.contentDocument;
    if (!doc) return;

    // The renderer already stamps a unique class per block path (\`b0-1-2\`), so
    // the mapping needs no second identity scheme and no renderer change.
    doc.addEventListener("click", (event) => {
      const el = event.target instanceof Element ? event.target.closest('[class*="b"]') : null;
      const cls = el && [...el.classList].find((c) => /^b\\d+(-\\d+)*$/.test(c));
      if (!cls) return;
      event.preventDefault();
      location.search = "?block=" + cls.slice(1);
    }, true);

    const current = new URLSearchParams(location.search).get("block");
    if (!current) return;
    const target = doc.querySelector("." + CSS.escape("b" + current));
    if (!target) return;
    target.style.outline = "2px solid #1a7f5a";
    target.style.outlineOffset = "2px";
    target.scrollIntoView({ block: "center", behavior: "smooth" });
  });
})();
</script>`;
}
