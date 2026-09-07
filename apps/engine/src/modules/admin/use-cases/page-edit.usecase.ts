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
import { SiteSpec, type Block, type Page } from "@forinda-cms/spec";

import { ApplySpecUseCase } from "./apply-spec.usecase";

/** Where a block sits: the page it belongs to, then its index at each depth. */
export type BlockPath = readonly number[];

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
  move(spec: SiteSpec, pageKey: string, path: BlockPath, delta: number, input: EditInput) {
    return this.edit(spec, pageKey, input, (blocks) => {
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
  nest(spec: SiteSpec, pageKey: string, path: BlockPath, input: EditInput) {
    return this.edit(spec, pageKey, input, (blocks) => {
      const found = resolve(blocks, path);
      if (!found) return "That block no longer exists.";

      const { parent, index } = found;
      if (index === 0) return "There is nothing above it to nest into.";

      const target = parent[index - 1]!;
      if (target.data) return "That section repeats a query; nest inside its template instead.";

      const [moved] = parent.splice(index, 1);
      target.children = [...(target.children ?? []), moved!];
      return null;
    });
  }

  unnest(spec: SiteSpec, pageKey: string, path: BlockPath, input: EditInput) {
    return this.edit(spec, pageKey, input, (blocks) => {
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
  add(spec: SiteSpec, pageKey: string, path: BlockPath | null, type: string, input: EditInput) {
    return this.edit(spec, pageKey, input, (blocks) => {
      const fresh = { type } as Block;

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

  duplicate(spec: SiteSpec, pageKey: string, path: BlockPath, input: EditInput) {
    return this.edit(spec, pageKey, input, (blocks) => {
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
  remove(spec: SiteSpec, pageKey: string, path: BlockPath, input: EditInput) {
    return this.edit(spec, pageKey, input, (blocks) => {
      const found = resolve(blocks, path);
      if (!found) return "That block no longer exists.";
      found.parent.splice(found.index, 1);
      return null;
    });
  }

  /** Replace one block's attributes and tier-2 style (ADR 0004). */
  restyle(
    spec: SiteSpec,
    pageKey: string,
    path: BlockPath,
    next: { attrs?: Record<string, unknown>; style?: Record<string, unknown> },
    input: EditInput,
  ) {
    return this.edit(spec, pageKey, input, (blocks) => {
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
   * One edit: copy the spec, mutate the copy, validate it, apply it.
   *
   * The copy matters. Mutating the caller's spec would leave a half-applied tree
   * behind when validation rejects the result — the state a canvas must never
   * be in, because the next click would build on it.
   */
  private async edit(
    spec: SiteSpec,
    pageKey: string,
    input: EditInput,
    mutate: (blocks: Block[]) => string | null,
  ): Promise<EditResult> {
    const draft = structuredClone(spec) as SiteSpec & { pages: Page[] };
    const page = draft.pages.find((p) => p.key === pageKey);
    if (!page) return { ok: false, error: `No page named "${pageKey}".` };

    const blocks = page.blocks as Block[];
    const refusal = mutate(blocks);
    if (refusal) return { ok: false, error: refusal };

    const validated = SiteSpec.safeParse(draft);
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
