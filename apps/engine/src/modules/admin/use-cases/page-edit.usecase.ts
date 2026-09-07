/**
 * Editing a page's block tree.
 *
 * ADR 0017 §4: every canvas action produces the spec the page should have and
 * sends it through `ApplySpecUseCase`. So this file owns the tree surgery and
 * nothing else — no writes, no classification, no history. Undo, the
 * destructive gate and the `source` column are inherited rather than
 * reimplemented, which is the whole reason the canvas is not a second path.
 *
 * Paths are the ones the renderer already stamps on every block as a class
 * (`b0-1-2`), so a click in the iframe and an edit here are talking about the
 * same node without a second identity scheme to keep in step.
 */
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";
import {
  checkReferences,
  Key,
  SiteSpec,
  type Block,
  type Component,
  type Page,
} from "@forinda-cms/spec";

import { ApplySpecUseCase } from "./apply-spec.usecase";

/** Where a block sits: the page it belongs to, then its index at each depth. */
export type BlockPath = readonly number[];

/**
 * Which tree an edit is against.
 *
 * A component is a block tree with a name (ADR 0022), so every operation here
 * works on one unchanged — the surgery never knew what it was inside. Naming
 * the target explicitly rather than letting a bare string mean "page" keeps the
 * two from being confused at a call site, which is the only place they could be.
 */
export type EditTarget = { readonly page: string } | { readonly component: string };

export interface EditInput {
  readonly actor: string;
  /** Set when a move would drop content the owner has not agreed to lose. */
  readonly allowDestructive?: boolean;
}

export type EditResult = { ok: true; seq: number } | { ok: false; error: string };

@Service({ scope: Lifetime.REQUEST })
export class PageEditUseCase {
  constructor(@Inject(ApplySpecUseCase) private readonly applySpec: ApplySpecUseCase) {}

  /** Move a block up or down among its siblings. */
  move(spec: SiteSpec, target: EditTarget, path: BlockPath, delta: number, input: EditInput) {
    return this.edit(spec, target, input, (blocks) => {
      const found = resolve(blocks, path);
      if (!found) return "That block no longer exists.";

      const { parent, index: from } = found;
      const to = from + delta;
      if (to < 0 || to >= parent.length) return "It is already at the end of its section.";

      const [moved] = parent.splice(from, 1);
      parent.splice(to, 0, moved!);
      return null;
    });
  }

  /**
   * Move a block into the block above it, or out to its grandparent.
   *
   * The two operations a tree needs that a list does not, and the reason the
   * canvas can build a real layout with four buttons and no drag: nesting is
   * how `section > stack > text` gets made.
   */
  nest(spec: SiteSpec, target: EditTarget, path: BlockPath, input: EditInput) {
    return this.edit(spec, target, input, (blocks) => {
      const found = resolve(blocks, path);
      if (!found) return "That block no longer exists.";

      const { parent, index } = found;
      if (index === 0) return "There is nothing above it to nest into.";

      const above = parent[index - 1]!;
      if (above.data) return "That section repeats a query; nest inside its template instead.";

      const [moved] = parent.splice(index, 1);
      above.children = [...(above.children ?? []), moved!];
      return null;
    });
  }

  unnest(spec: SiteSpec, target: EditTarget, path: BlockPath, input: EditInput) {
    return this.edit(spec, target, input, (blocks) => {
      if (path.length < 2) return "It is already at the top level.";

      const found = resolve(blocks, path);
      const grandparent = containerOf(blocks, path.slice(0, -1));
      if (!found || !grandparent) return "That block no longer exists.";

      const [moved] = found.parent.splice(found.index, 1);
      grandparent.splice(path[path.length - 2]! + 1, 0, moved!);
      return null;
    });
  }

  /** Add a block after the selected one, or at the end when nothing is selected. */
  add(
    spec: SiteSpec,
    target: EditTarget,
    path: BlockPath | null,
    type: string,
    input: EditInput,
    /** Set when the new block needs one to mean anything — `use` for a component. */
    attrs?: Record<string, unknown>,
  ) {
    return this.edit(spec, target, input, (blocks) => {
      const fresh = (attrs ? { type, attrs } : { type }) as Block;

      if (!path) {
        blocks.push(fresh);
        return null;
      }

      const found = resolve(blocks, path);
      if (!found) return "That block no longer exists.";
      found.parent.splice(found.index + 1, 0, fresh);
      return null;
    });
  }

  duplicate(spec: SiteSpec, target: EditTarget, path: BlockPath, input: EditInput) {
    return this.edit(spec, target, input, (blocks) => {
      const found = resolve(blocks, path);
      if (!found) return "That block no longer exists.";

      found.parent.splice(found.index + 1, 0, structuredClone(found.parent[found.index]!));
      return null;
    });
  }

  /**
   * Remove a block and everything inside it.
   *
   * Routed through the destructive gate rather than judged here: deleting a
   * section that renders a collection is exactly the change ADR 0002 says an
   * owner must confirm, and the classifier already knows how to say what is
   * lost.
   */
  remove(spec: SiteSpec, target: EditTarget, path: BlockPath, input: EditInput) {
    return this.edit(spec, target, input, (blocks) => {
      const found = resolve(blocks, path);
      if (!found) return "That block no longer exists.";
      found.parent.splice(found.index, 1);
      return null;
    });
  }

  /**
   * Publish or unpublish the page itself.
   *
   * `draft` has been in the schema since the first version and nothing read it,
   * so an unpublished page was served like any other. Now it means what it
   * says, and this is the action that flips it — the one place in the canvas
   * where "make this live" is a decision rather than a side effect of typing.
   */
  async setPublished(
    spec: SiteSpec,
    pageKey: string,
    published: boolean,
    input: EditInput,
  ): Promise<EditResult> {
    const draft = structuredClone(spec) as SiteSpec & { pages: Page[] };
    const page = draft.pages.find((p) => p.key === pageKey);
    if (!page) return { ok: false, error: `No page named "${pageKey}".` };

    page.draft = !published;

    try {
      const { seq } = await this.applySpec.execute(SiteSpec.parse(draft), {
        actor: input.actor,
        source: "canvas",
        // Unpublishing is classified destructive — it takes a live URL away —
        // and the person pressing the button in the canvas is the confirmation.
        allowDestructive: true,
      });
      return { ok: true, seq };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Change just the words in a block.
   *
   * Separate from `restyle` because inline editing on the canvas sends only the
   * text: replacing the whole attribute set from a double-click would drop a
   * heading's `level` and a button's `to`, which is a data loss the editor
   * would never mention.
   */
  setText(spec: SiteSpec, target: EditTarget, path: BlockPath, text: string, input: EditInput) {
    return this.edit(spec, target, input, (blocks) => {
      const found = resolve(blocks, path);
      if (!found) return "That block no longer exists.";

      const block = found.parent[found.index]!;
      const attrs = { ...((block.attrs ?? {}) as Record<string, unknown>) };

      // The attribute this block actually uses for its words, not a guess: a
      // button carries `label`, a heading `text`, a page section `title`.
      const key = ["text", "label", "title", "heading"].find((name) => name in attrs) ?? "text";
      attrs[key] = text;
      block.attrs = attrs;
      return null;
    });
  }

  /**
   * Move a block to a new index among its own siblings.
   *
   * What a drag produces. Distinct from `move`, which steps one place: dragging
   * five rows up is one edit and one patch, not five.
   */
  reorder(spec: SiteSpec, target: EditTarget, path: BlockPath, to: number, input: EditInput) {
    return this.edit(spec, target, input, (blocks) => {
      const found = resolve(blocks, path);
      if (!found) return "That block no longer exists.";

      const { parent, index } = found;
      const landing = Math.max(0, Math.min(to, parent.length - 1));
      if (landing === index) return null;

      const [moved] = parent.splice(index, 1);
      parent.splice(landing, 0, moved!);
      return null;
    });
  }

  /** Replace one block's attributes and tier-2 style (ADR 0004). */
  restyle(
    spec: SiteSpec,
    target: EditTarget,
    path: BlockPath,
    next: { attrs?: Record<string, unknown>; style?: Record<string, unknown> },
    input: EditInput,
  ) {
    return this.edit(spec, target, input, (blocks) => {
      const found = resolve(blocks, path);
      if (!found) return "That block no longer exists.";
      const block = found.parent[found.index]!;

      // Assigned, not merged: the inspector always submits every field it shows,
      // so a merge would make clearing a value impossible.
      if (next.attrs) block.attrs = Object.keys(next.attrs).length > 0 ? next.attrs : undefined;
      if (next.style)
        block.style =
          Object.keys(next.style).length > 0 ? (next.style as Block["style"]) : undefined;
      return null;
    });
  }

  /**
   * Turn the selected block into a reusable component, in place.
   *
   * Where a component comes from in practice: someone built a call-to-action
   * band, likes it, and wants it on four more pages. Extracting it here rather
   * than authoring components separately means the thing that gets reused is
   * the thing that was already working — and the page it came from keeps
   * rendering identically, because the instance placed in its hole expands to
   * exactly what was lifted out.
   */
  async saveAsComponent(
    spec: SiteSpec,
    target: EditTarget,
    path: BlockPath,
    label: string,
    input: EditInput,
  ): Promise<EditResult> {
    const trimmed = label.trim();
    if (!trimmed) return { ok: false, error: "Give the component a name." };

    const key = slug(trimmed);
    if (!Key.safeParse(key).success) {
      return { ok: false, error: "That name has no letters or digits in it." };
    }
    if (spec.components.some((c) => c.key === key)) {
      return { ok: false, error: `There is already a component called "${trimmed}".` };
    }

    const draft = structuredClone(spec) as SiteSpec & {
      pages: Page[];
      components: Component[];
    };
    const blocks = rootOf(draft, target);
    if (!blocks) return { ok: false, error: "That block no longer exists." };

    const found = resolve(blocks, path);
    if (!found) return { ok: false, error: "That block no longer exists." };

    const lifted = found.parent[found.index]!;
    if (lifted.type === "component") {
      return { ok: false, error: "That is already a component." };
    }
    // One level deep (ADR 0022): a component cannot hold another, so a subtree
    // that places one cannot be lifted whole.
    if (placesComponent(lifted)) {
      return {
        ok: false,
        error: "That section places another component. Components are one level deep.",
      };
    }

    draft.components.push({ key, label: trimmed, blocks: [lifted] });
    found.parent[found.index] = { type: "component", attrs: { use: key } };

    return this.apply(draft, input);
  }

  /**
   * One edit: copy the spec, mutate the copy, validate it, apply it.
   *
   * The copy matters. Mutating the caller's spec would leave a half-applied tree
   * behind when validation rejects the result — the state a canvas must never
   * be in, because the next click would build on it.
   */
  private async edit(
    spec: SiteSpec,
    target: EditTarget,
    input: EditInput,
    mutate: (blocks: Block[]) => string | null,
  ): Promise<EditResult> {
    const draft = structuredClone(spec) as SiteSpec & {
      pages: Page[];
      components: Component[];
    };
    const blocks = rootOf(draft, target);
    if (!blocks) {
      return {
        ok: false,
        error:
          "page" in target
            ? `No page named "${target.page}".`
            : `No component named "${target.component}".`,
      };
    }

    const refusal = mutate(blocks);
    if (refusal) return { ok: false, error: refusal };

    return this.apply(draft, input);
  }

  private async apply(draft: SiteSpec, input: EditInput): Promise<EditResult> {
    const validated = SiteSpec.safeParse(draft);
    if (validated.success) {
      // References too, not only shape: placing a component inside a component
      // is a well-formed document and a forbidden one (ADR 0022), and the
      // canvas should say so instead of writing it and rendering nothing.
      const issues = checkReferences(validated.data);
      if (issues[0]) return { ok: false, error: issues[0].message };
    }
    if (!validated.success) {
      // The tree is well-formed but the spec is not — a block type that requires
      // an attribute, usually. Reported rather than written.
      return {
        ok: false,
        error: validated.error.issues[0]?.message ?? "That change is not valid.",
      };
    }

    try {
      const { seq } = await this.applySpec.execute(validated.data, {
        actor: input.actor,
        source: "canvas",
        allowDestructive: input.allowDestructive === true,
      });
      return { ok: true, seq };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/** The block array an edit works on: a page's, or a component's. */
function rootOf(
  draft: SiteSpec & { pages: Page[]; components: Component[] },
  target: EditTarget,
): Block[] | undefined {
  const owner =
    "page" in target
      ? draft.pages.find((p) => p.key === target.page)
      : draft.components.find((c) => c.key === target.component);
  return owner?.blocks as Block[] | undefined;
}

/** True when a subtree places a component anywhere inside it. */
function placesComponent(block: Block): boolean {
  if (block.type === "component") return true;
  return [...(block.children ?? []), ...(block.item ?? [])].some(placesComponent);
}

/** A name an owner typed, as a `Key`. */
function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The container and the block a path points at.
 *
 * Both, together, because checking only the container let a stale index through:
 * `[9]` on a three-block page resolved the page's own list, spliced nothing, and
 * applied a spec identical to the one it started with — a no-op patch in the
 * history and a canvas that reported success for an edit that never happened.
 */
function resolve(blocks: Block[], path: BlockPath): { parent: Block[]; index: number } | null {
  const parent = containerOf(blocks, path);
  const index = path[path.length - 1];

  if (!parent || index === undefined || !parent[index]) return null;
  return { parent, index };
}

/** The array a path's last index points into, or `undefined` if the path is stale. */
function containerOf(blocks: Block[], path: BlockPath): Block[] | undefined {
  let current = blocks;

  for (const index of path.slice(0, -1)) {
    const block = current[index];
    if (!block) return undefined;
    // `item` is the template of a repeating block; its children are one row's
    // worth. Descending into it edits every row at once, which is what the
    // author means.
    const next = block.children ?? block.item;
    if (!next) return undefined;
    current = next as Block[];
  }

  return current;
}
