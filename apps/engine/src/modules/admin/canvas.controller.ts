/**
 * The visual canvas (ADR 0017).
 *
 * Three panes: the block tree, the real page in an iframe, and an inspector
 * generated from the block's own declarations. Every action is a form post that
 * produces the whole spec and applies it — so undo, history and the destructive
 * gate cover the canvas without this file knowing they exist.
 *
 * The route is `/admin/pages/:key`, which the dashboard already links to as
 * "view"; it links here now.
 */
import { Controller, Get, Inject, Post, type Ctx } from "@forinda/kickjs";
import { BLOCKS } from "@/plugins";
import type { Block } from "@forinda-cms/spec";

import { SiteSpecUseCase } from "@/shared/use-cases";
import { PageEditUseCase } from "./use-cases/page-edit.usecase";
import { canvas } from "./utils/canvas.view";
import { inspector } from "./utils/inspector";
import { html, notFound, redirect } from "./utils/http";
import { esc, page as shell } from "./utils/view";

@Controller()
export class CanvasController {
  @Inject(SiteSpecUseCase) private readonly specs!: SiteSpecUseCase;
  @Inject(PageEditUseCase) private readonly edits!: PageEditUseCase;

  @Get("/pages/:key")
  async show(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = String((ctx.params as Record<string, string>)["key"] ?? "");
    const page = spec?.pages.find((p) => p.key === key);
    if (!spec || !page) return notFound(ctx);

    const query = ctx.query as Record<string, unknown>;
    const selected = parsePath(query["block"]);
    const error = typeof query["error"] === "string" ? query["error"] : undefined;

    const block = selected ? blockAt(page.blocks, selected) : undefined;
    const type = block ? BLOCKS[block.type] : undefined;

    html(
      ctx,
      200,
      shell({
        title: `${page.title} — canvas`,
        trail: [{ label: "Pages", href: "/admin" }, { label: page.title }],
        body: canvas({
          spec,
          page,
          registry: BLOCKS,
          selected,
          error,
          // The page as the site serves it, in the site's own theme. `?edit`
          // exists so the public renderer can suppress anything that should not
          // run inside an editor later; today it changes nothing.
          previewUrl: `${page.path}?edit=1`,
          inspector:
            block && selected
              ? inspector({
                  block,
                  type,
                  path: selected,
                  colors: Object.keys(spec.theme.colors),
                  typeScale: Object.keys(spec.theme.typeScale),
                  action: `/admin/pages/${esc(page.key)}/style`,
                })
              : "",
        }),
      }),
    );
  }

  /**
   * Structural edits: move, nest, duplicate, delete, add.
   *
   * One route rather than six, because they are one form — the tree's buttons
   * all submit the same `op`, and a route per verb would be six places to keep
   * the actor and the redirect in step.
   */
  @Post("/pages/:key")
  async act(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = String((ctx.params as Record<string, string>)["key"] ?? "");
    if (!spec || !spec.pages.some((p) => p.key === key)) return notFound(ctx);

    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const [op, target] = String(body["op"] ?? "").split(":");
    const path = parsePath(target ?? body["block"]);
    const actor = ctx.require("actor").email;

    const result = await (async () => {
      switch (op) {
        case "up":
          return path ? this.edits.move(spec, key, path, -1, { actor }) : refuse();
        case "down":
          return path ? this.edits.move(spec, key, path, 1, { actor }) : refuse();
        case "nest":
          return path ? this.edits.nest(spec, key, path, { actor }) : refuse();
        case "unnest":
          return path ? this.edits.unnest(spec, key, path, { actor }) : refuse();
        case "dup":
          return path ? this.edits.duplicate(spec, key, path, { actor }) : refuse();
        case "del":
          // Confirmed by construction: the button says delete, and the gate
          // still refuses if the classifier decides content is lost.
          return path ? this.edits.remove(spec, key, path, { actor }) : refuse();
        case "publish":
          return this.edits.setPublished(spec, key, true, { actor });
        case "unpublish":
          return this.edits.setPublished(spec, key, false, { actor });
        case "add":
          return this.edits.add(spec, key, path, String(body["type"] ?? "text"), { actor });
        case "to": {
          // From a drag: the block and where it landed among its siblings.
          const to = Number(body["to"]);
          return path && Number.isInteger(to)
            ? this.edits.reorder(spec, key, path, to, { actor })
            : refuse();
        }
        default:
          return refuse();
      }
    })();

    // Back to the canvas either way, with the failure in the URL rather than
    // rendered here — a refresh after a failed move should not repost it.
    const selected = path ? `?block=${path.join("-")}` : "";
    const suffix = result.ok
      ? selected
      : `${selected || "?"}${selected ? "&" : ""}error=${encodeURIComponent(result.error)}`;

    redirect(ctx, `/admin/pages/${key}${suffix}`);
  }

  /**
   * Inline editing: the words in one block, and nothing else.
   *
   * Answers JSON rather than redirecting — this is called while someone is
   * typing on the page, and a full reload after every edited heading would lose
   * their place and their scroll position.
   */
  @Post("/pages/:key/text")
  async setText(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = String((ctx.params as Record<string, string>)["key"] ?? "");
    if (!spec || !spec.pages.some((p) => p.key === key)) return notFound(ctx);

    const body = ctx.body as Record<string, unknown>;
    const path = parsePath(body["path"]);
    if (!path) return json(ctx, 400, { error: "No block." });

    const result = await this.edits.setText(spec, key, path, String(body["text"] ?? ""), {
      actor: ctx.require("actor").email,
    });

    json(ctx, result.ok ? 200 : 409, result.ok ? { ok: true } : { error: result.error });
  }

  /** The inspector's save: attributes and tier-2 style for one block. */
  @Post("/pages/:key/style")
  async style(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = String((ctx.params as Record<string, string>)["key"] ?? "");
    if (!spec || !spec.pages.some((p) => p.key === key)) return notFound(ctx);

    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const path = parsePath(body["path"]);
    if (!path) return redirect(ctx, `/admin/pages/${key}`);

    const attrs: Record<string, unknown> = {};
    const style: Record<string, unknown> = {};

    for (const [name, raw] of Object.entries(body)) {
      const value = typeof raw === "string" ? raw.trim() : raw;
      // An empty select is "unset", not the empty string — writing `""` would
      // put a meaningless value in the spec and show it back as a real choice.
      if (value === "" || value === undefined) continue;

      // `__`, not `.` — see the note in the inspector: a dotted name can be
      // reinterpreted as a nested object by the body parser, and the flat
      // lookup then silently writes nothing.
      if (name.startsWith("attr__")) attrs[name.slice(6)] = coerce(value);
      else if (name.startsWith("style__")) style[name.slice(7)] = value;
    }

    const result = await this.edits.restyle(
      spec,
      key,
      path,
      { attrs, style },
      { actor: ctx.require("actor").email },
    );

    // A live edit asks for JSON: the panel applies changes as they are made, and
    // a redirect there would reload the page under someone's cursor — losing
    // their scroll position, their selection, and the field they were in.
    if (wantsJson(ctx)) {
      return json(ctx, result.ok ? 200 : 409, result.ok ? { ok: true } : { error: result.error });
    }

    const query = result.ok
      ? `?block=${path.join("-")}`
      : `?block=${path.join("-")}&error=${encodeURIComponent(result.error)}`;
    redirect(ctx, `/admin/pages/${key}${query}`);
  }
}

/** True when the caller is the panel's script rather than a form post. */
function wantsJson(ctx: Ctx): boolean {
  const accept = (ctx.req.headers as Record<string, string | string[] | undefined>)["accept"];
  const header = Array.isArray(accept) ? accept[0] : accept;
  return typeof header === "string" && header.includes("application/json");
}

function json(ctx: Ctx, status: number, body: unknown): void {
  ctx.res.statusCode = status;
  ctx.res.setHeader("content-type", "application/json; charset=utf-8");
  ctx.res.end(JSON.stringify(body));
}

function refuse() {
  return { ok: false as const, error: "Select a block first." };
}

/** `"0-1-2"` → `[0, 1, 2]`, and anything else → `null`. */
function parsePath(value: unknown): number[] | null {
  if (typeof value !== "string" || value === "") return null;
  const parts = value.split("-").map(Number);
  return parts.every((n) => Number.isInteger(n) && n >= 0) ? parts : null;
}

/** The block a path points at, or nothing when the path is stale. */
function blockAt(blocks: readonly Block[], path: readonly number[]): Block | undefined {
  let siblings: readonly Block[] | undefined = blocks;
  let block: Block | undefined;

  for (const index of path) {
    block = siblings?.[index];
    if (!block) return undefined;
    // `item` is a repeating block's template: descending into it edits the row
    // template, which is the one thing an author can meaningfully change there.
    siblings = block.children ?? block.item;
  }

  return block;
}

/** A form sends everything as a string; numbers and booleans are recoverable. */
function coerce(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}
