/**
 * The canvas: a tree, the real page, and a generated inspector.
 *
 * ADR 0017 §2 — the middle pane is an iframe of the actual rendered page, so
 * there is no fidelity gap to manage. §5 — every action is a form that posts
 * and re-renders; the script adds selection, dragging, inline editing and the
 * viewport sizes on top of that, and its absence costs none of the function.
 */
import type { Block, Page, SiteSpec } from "@forinda-cms/spec";
import type { BlockType } from "@forinda-cms/render";

import { esc } from "./view";

export interface CanvasOptions {
  readonly spec: SiteSpec;
  readonly page: Page;
  /**
   * Where this canvas posts: `/admin/pages/home` or `/admin/components/cta`.
   *
   * The one thing that differs between editing a page and editing a component
   * (ADR 0022) — everything else on this screen is the same tree, the same
   * inspector and the same script.
   */
  readonly base: string;
  readonly registry: Record<string, BlockType>;
  readonly selected: readonly number[] | null;
  readonly inspector: string;
  readonly previewUrl: string;
  readonly error?: string | undefined;
}

/**
 * The widths people design for.
 *
 * Named rather than numbered — an owner asks "does it work on a phone", not
 * "does it work at 390px" — and they match the breakpoints the style props
 * actually use, so what the canvas shows is what `hideOn` and a responsive
 * `padding` will do.
 */
const VIEWPORTS = [
  { id: "desktop", label: "Desktop", width: 0 },
  { id: "tablet", label: "Tablet", width: 820 },
  { id: "mobile", label: "Mobile", width: 390 },
] as const;

/** One row per block, indented by depth — the structure, as structure. */
function tree(
  blocks: readonly Block[],
  registry: Record<string, BlockType>,
  selected: string,
  components: ReadonlyMap<string, string>,
  path: readonly number[] = [],
): string {
  return blocks
    .map((block, index) => {
      const here = [...path, index];
      const id = here.join("-");
      const children = block.children ?? block.item ?? [];
      const use = block.type === "component" ? String((block.attrs ?? {})["use"] ?? "") : "";
      const label = use ? (components.get(use) ?? use) : summarise(block, registry[block.type]);

      return `<li>
  <div class="node${id === selected ? " selected" : ""}" draggable="true"
       data-block="${esc(id)}" data-index="${index}">
    <a href="?block=${esc(id)}">${esc(label)}</a>${block.data ? '<span class="pill">repeats</span>' : ""}${
      use
        ? `<a class="pill" href="/admin/components/${esc(use)}" title="A component — edit it everywhere it is used">component</a>`
        : ""
    }
    <span class="node-actions">
      <button form="act" name="op" value="up:${esc(id)}" title="Move up">↑</button>
      <button form="act" name="op" value="down:${esc(id)}" title="Move down">↓</button>
      <button form="act" name="op" value="nest:${esc(id)}" title="Nest into the block above">→</button>
      <button form="act" name="op" value="unnest:${esc(id)}" title="Move out">←</button>
      <button form="act" name="op" value="dup:${esc(id)}" title="Duplicate">⧉</button>
      <button form="act" name="op" value="del:${esc(id)}" title="Delete" class="destructive">✕</button>
    </span>
  </div>
  ${
    children.length > 0
      ? `<ul>${tree(children, registry, selected, components, block.data ? [...here, 0] : here)}</ul>`
      : ""
  }
</li>`;
    })
    .join("\n");
}

/**
 * What a block is, in the owner's words.
 *
 * Its own text where it has some, its type otherwise — a tree of fifteen rows
 * all reading "text" is a tree nobody can navigate.
 */
function summarise(block: Block, type: BlockType | undefined): string {
  const attrs = (block.attrs ?? {}) as Record<string, unknown>;
  for (const key of ["text", "label", "title", "heading"]) {
    const value = attrs[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.length > 36 ? `${value.slice(0, 36)}…` : value;
    }
  }
  return type ? type.name : `${block.type} (unknown)`;
}

export function canvas(options: CanvasOptions): string {
  const { spec, page, base, registry, selected, inspector, previewUrl, error } = options;
  const selectedId = selected ? selected.join("-") : "";
  const editingComponent = base.startsWith("/admin/components/");
  const names = new Map(spec.components.map((c) => [c.key, c.label ?? c.key]));

  const blocks = Object.values(registry)
    .map(
      (type) =>
        `<option value="${esc(type.name)}">${esc(type.name)} — ${esc(type.summary)}</option>`,
    )
    .join("");

  // Components sit in their own group, and only where they may be placed: one
  // level deep (ADR 0022) means a component's own canvas cannot offer them.
  const reusable =
    editingComponent || spec.components.length === 0
      ? ""
      : `<optgroup label="Your components">${spec.components
          .map(
            (c) =>
              `<option value="component:${esc(c.key)}">${esc(c.label ?? c.key)} — used wherever it is placed</option>`,
          )
          .join("")}</optgroup>`;

  const palette = reusable ? `<optgroup label="Blocks">${blocks}</optgroup>${reusable}` : blocks;

  const sizes = VIEWPORTS.map(
    (viewport) =>
      `<button type="button" class="size${viewport.id === "desktop" ? " on" : ""}"
         data-width="${viewport.width}">${viewport.label}</button>`,
  ).join("");

  return `${error ? `<p class="error">${esc(error)}</p>` : ""}
<div class="canvas" data-page="${esc(page.key)}" data-base="${esc(base)}">
  <aside class="tree">
    <h2>${esc(page.title)}</h2>
    <p class="help">${esc(page.path)}</p>
    <ul class="blocks">${tree(page.blocks, registry, selectedId, names)}</ul>

    <form method="post" id="act" class="add">
      <input type="hidden" name="block" value="${esc(selectedId)}">
      <input type="hidden" name="to" value="">
      <label for="add-type">Add a block</label>
      <div class="row">
        <select id="add-type" name="type">${palette}</select>
        <button name="op" value="add" type="submit">Add</button>
      </div>
      <p class="help">Added after the selected block, or at the end.</p>
    </form>

    ${
      editingComponent
        ? '<p class="help">Editing a component. Every page that places it changes with it.</p>'
        : `<form method="post" class="add">
      <input type="hidden" name="block" value="${esc(selectedId)}">
      <label for="save-component">Save the selected section as a component</label>
      <div class="row">
        <input id="save-component" name="name" placeholder="Call to action"${selectedId ? "" : " disabled"}>
        <button name="op" value="component:${esc(selectedId)}" type="submit"${selectedId ? "" : " disabled"}>Save</button>
      </div>
      <p class="help">Reuse it on other pages. Editing it there changes it here.</p>
    </form>`
    }

    ${
      spec.components.length > 0
        ? `<nav class="components">
      <h3>Components</h3>
      <ul>${spec.components
        .map(
          (c) => `<li><a href="/admin/components/${esc(c.key)}">${esc(c.label ?? c.key)}</a></li>`,
        )
        .join("")}</ul>
    </nav>`
        : ""
    }
  </aside>

  <div class="stage">
    <div class="viewport-bar">
      <span class="sizes">${sizes}</span>
      <span class="stage-actions">
        ${
          editingComponent
            ? '<span class="pill">component</span>'
            : page.draft
              ? `<span class="pill">draft — not public</span>
               <button form="act" name="op" value="publish" class="publish">Publish page</button>`
              : `<span class="pill live">live</span>
               <button form="act" name="op" value="unpublish" class="link">Unpublish</button>
               <a href="${esc(page.path)}" target="_blank" rel="noopener" class="muted">Open ↗</a>`
        }
      </span>
    </div>
    <div class="preview" id="frame-wrap">
      <iframe src="${esc(previewUrl)}" title="${esc(page.title)}" id="page"></iframe>
    </div>
    <p class="help">
      Click a section to select it. Double-click text to edit it here. Every change is
      saved as you make it${page.draft ? " — this page stays private until you publish it" : ""}.
    </p>
  </div>

  <aside class="panel">
    ${selected ? inspector : '<p class="help">Select a block to edit it.</p>'}
  </aside>
</div>

<script>
${SCRIPT}
</script>`;
}

/**
 * The enhancement layer.
 *
 * Everything above works with this deleted (ADR 0017 §5): the tree's buttons
 * are form submits and the inspector is a form. This adds the three things a
 * person expects from an editor and cannot get from a form — click what you
 * see, drag to reorder, type on the page — plus the viewport sizes, which
 * matter because the style props are responsive and a design decision made at
 * one width is a guess at the others.
 */
const SCRIPT = String.raw`
(() => {
  const canvas = document.querySelector('.canvas');
  const frame = document.getElementById('page');
  const act = document.getElementById('act');
  if (!canvas || !frame || !act) return;

  // Where this canvas posts — a page's route or a component's (ADR 0022).
  const base = canvas.dataset.base;
  const selected = new URLSearchParams(location.search).get('block');

  const select = (id) => { location.search = '?block=' + id; };
  const submit = (op, extra = {}) => {
    for (const [name, value] of Object.entries(extra)) {
      const field = act.elements.namedItem(name);
      if (field) field.value = String(value);
    }
    const op_ = document.createElement('input');
    op_.type = 'hidden'; op_.name = 'op'; op_.value = op;
    act.appendChild(op_);
    act.submit();
  };

  // ---- viewport sizes -----------------------------------------------------
  const wrap = document.getElementById('frame-wrap');
  for (const button of canvas.querySelectorAll('.size')) {
    button.addEventListener('click', () => {
      const width = Number(button.dataset.width);
      wrap.style.maxWidth = width ? width + 'px' : '';
      wrap.style.margin = width ? '0 auto' : '';
      for (const other of canvas.querySelectorAll('.size')) other.classList.toggle('on', other === button);
    });
  }

  // ---- dragging the tree --------------------------------------------------
  let dragging = null;
  for (const node of canvas.querySelectorAll('.node')) {
    node.addEventListener('dragstart', (event) => {
      dragging = node;
      event.dataTransfer.effectAllowed = 'move';
    });
    node.addEventListener('dragover', (event) => {
      if (!dragging || dragging === node) return;
      // Same parent only: a drag across levels is a nest, and nesting by
      // accident is worse than a button that says so.
      if (parentOf(dragging) !== parentOf(node)) return;
      event.preventDefault();
      node.classList.add('drop');
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop'));
    node.addEventListener('drop', (event) => {
      event.preventDefault();
      node.classList.remove('drop');
      if (!dragging || dragging === node) return;
      submit('to:' + dragging.dataset.block, { to: node.dataset.index });
    });
  }

  const parentOf = (node) => (node.dataset.block || '').split('-').slice(0, -1).join('-');

  // ---- the panel applies as you go ---------------------------------------
  // A Save button is a promise that nothing has happened yet, which is the
  // wrong promise for a visual editor: the point of showing the real page is
  // that a change to it is visible immediately. Save stays for anyone without
  // this script, and as the way to force a write.
  const panel = document.querySelector('form.inspector');
  if (panel) {
    let pending = null;
    let saving = false;

    const apply = async () => {
      if (saving) return;
      saving = true;
      panel.classList.add('saving');

      try {
        const response = await fetch(panel.action, {
          method: 'POST',
          headers: { accept: 'application/json' },
          body: new FormData(panel),
        });

        if (response.ok) {
          // Only the frame: reloading the page would take the cursor out of the
          // field being used.
          frame.contentWindow.location.reload();
          syncTreeLabel();
        } else {
          const body = await response.json().catch(() => ({}));
          note(body.error || 'That change could not be applied.');
        }
      } catch {
        note('Could not reach the server.');
      } finally {
        saving = false;
        panel.classList.remove('saving');
      }
    };

    // Selects land immediately — a dropdown has one deliberate value. Typing is
    // debounced, or every keystroke becomes its own entry in history.
    const schedule = (wait) => {
      clearTimeout(pending);
      pending = setTimeout(apply, wait);
    };

    panel.addEventListener('change', (event) => {
      if (event.target.tagName === 'SELECT') schedule(0);
    });
    panel.addEventListener('input', (event) => {
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') schedule(600);
    });

    // The tree shows a block by its words, so an edited heading has to change
    // there too or the two panes disagree about what you are looking at.
    const syncTreeLabel = () => {
      const text = panel.querySelector('[name="attr__text"], [name="attr__label"], [name="attr__title"]');
      const row = selected && canvas.querySelector('.node[data-block="' + CSS.escape(selected) + '"] > a');
      if (text && row && text.value.trim() !== '') row.textContent = text.value.slice(0, 36);
    };
  }

  const note = (message) => {
    let bar = document.getElementById('canvas-note');
    if (!bar) {
      bar = document.createElement('p');
      bar.id = 'canvas-note';
      bar.className = 'error';
      canvas.parentNode.insertBefore(bar, canvas);
    }
    bar.textContent = message;
  };

  // ---- the page itself ----------------------------------------------------
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    if (!doc) return;

    // The renderer already stamps a unique class per block path ('b0-1-2'), so
    // the mapping needs no second identity scheme and no renderer change.
    const pathOf = (el) => {
      const node = el && el.closest ? el.closest('[class*="b"]') : null;
      const cls = node && [...node.classList].find((c) => /^b\d+(-\d+)*$/.test(c));
      return cls ? { el: node, id: cls.slice(1) } : null;
    };

    const style = doc.createElement('style');
    style.textContent =
      '[data-fcms-hover]{outline:1px dashed #1a7f5a;outline-offset:2px;cursor:pointer}' +
      '[data-fcms-on]{outline:2px solid #1a7f5a;outline-offset:2px}' +
      '[contenteditable="true"]{outline:2px solid #c2410c;outline-offset:2px}';
    doc.head.appendChild(style);

    let hovered = null;
    doc.addEventListener('mousemove', (event) => {
      const found = pathOf(event.target);
      if (hovered && hovered !== (found && found.el)) hovered.removeAttribute('data-fcms-hover');
      if (found && found.el.getAttribute('contenteditable') !== 'true') {
        found.el.setAttribute('data-fcms-hover', '');
        hovered = found.el;
      }
    });

    doc.addEventListener('click', (event) => {
      const found = pathOf(event.target);
      if (!found || event.target.isContentEditable) return;
      event.preventDefault();
      if (found.id !== selected) select(found.id);
    }, true);

    if (selected) {
      const current = doc.querySelector('.' + CSS.escape('b' + selected));
      if (current) {
        current.setAttribute('data-fcms-on', '');
        current.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }

    // ---- typing on the page ------------------------------------------------
    doc.addEventListener('dblclick', (event) => {
      const found = pathOf(event.target);
      if (!found) return;
      // Only where the words are the whole content. A section containing other
      // blocks is not text, and making it editable would let someone delete
      // their own layout with a keystroke.
      if (found.el.children.length > 0) return;

      const before = found.el.textContent;
      found.el.setAttribute('contenteditable', 'true');
      found.el.focus();

      const finish = async () => {
        found.el.removeAttribute('contenteditable');
        const text = found.el.textContent.trim();
        if (text === before.trim()) return;

        const body = new URLSearchParams({ path: found.id, text });
        const response = await fetch(base + '/text', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
        });
        // Reloaded on success so the tree label and the inspector agree with
        // the page — three views of one block that must not drift apart.
        if (response.ok) location.reload();
        else found.el.textContent = before;
      };

      found.el.addEventListener('blur', finish, { once: true });
      found.el.addEventListener('keydown', (key) => {
        if (key.key === 'Enter' && !key.shiftKey) { key.preventDefault(); found.el.blur(); }
        if (key.key === 'Escape') { found.el.textContent = before; found.el.blur(); }
      });
    });
  });
})();
`;
