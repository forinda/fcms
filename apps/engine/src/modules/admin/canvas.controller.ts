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

import { roleOf } from "@/shared/roles";
import { renderPage } from "@forinda-cms/render";

import { BLOCKS } from "@/plugins";
import type { Block, Page, SiteSpec } from "@forinda-cms/spec";

import { EntryReadUseCase, SiteSpecUseCase } from "@/shared/use-cases";
import { PageEditUseCase, type EditTarget } from "./use-cases/page-edit.usecase";
import { canvas } from "./utils/canvas.view";
import { inspector } from "./utils/inspector";
import { html, notFound, redirect } from "./utils/http";
import { esc, page as shell } from "./utils/view";

@Controller()
export class CanvasController {
  @Inject(SiteSpecUseCase) private readonly specs!: SiteSpecUseCase;
  @Inject(EntryReadUseCase) private readonly entries!: EntryReadUseCase;
  @Inject(PageEditUseCase) private readonly edits!: PageEditUseCase;

  @Get("/pages/:key")
  async show(ctx: Ctx): Promise<void> {
    return this.canvasFor(ctx, { page: keyOf(ctx) });
  }

  /**
   * The same canvas, editing a component instead of a page (ADR 0022).
   *
   * A component is a block tree with a name, so nothing below this line differs
   * — same tree, same inspector, same inline editing. What changes is the
   * preview: a component has no URL of its own, so the stage renders it on a
   * page of its own making.
   */
  @Get("/components/:key")
  async showComponent(ctx: Ctx): Promise<void> {
    return this.canvasFor(ctx, { component: keyOf(ctx) });
  }

  private async canvasFor(ctx: Ctx, target: EditTarget): Promise<void> {
    const spec = await this.specs.execute();
    const subject = spec ? subjectOf(spec, target) : undefined;
    if (!spec || !subject) return notFound(ctx);

    const { page, base } = subject;
    const key = "page" in target ? target.page : target.component;

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
          base,
          registry: BLOCKS,
          selected,
          error,
          // The page as the site serves it, in the site's own theme. `?edit`
          // exists so the public renderer can suppress anything that should not
          // run inside an editor later; today it changes nothing.
          previewUrl: "page" in target ? `${page.path}?edit=1` : `/admin/components/${key}/preview`,
          inspector:
            block?.type === "component"
              ? componentPanel(String((block.attrs ?? {})["use"] ?? ""), spec)
              : block && selected
                ? inspector({
                    block,
                    type,
                    path: selected,
                    colors: Object.keys(spec.theme.colors),
                    typeScale: Object.keys(spec.theme.typeScale),
                    action: `${base}/style`,
                  })
                : "",
        }),
      }),
    );
  }

  /**
   * A component on a page of its own, in the site's own theme.
   *
   * A component has no URL — it is a piece of pages, not a page — so the stage
   * needs one made for it. Rendered through the ordinary renderer with the real
   * spec, because a preview that renders differently from the site is a preview
   * that lies about the thing being edited (ADR 0017 §2).
   */
  @Get("/components/:key/preview")
  async preview(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const subject = spec ? subjectOf(spec, { component: keyOf(ctx) }) : undefined;
    if (!spec || !subject) return notFound(ctx);

    const source = await this.entries.source(spec.content.map((t) => t.key));
    const { html: body } = renderPage(subject.page, { spec, source, registry: BLOCKS });

    // The framework sends `X-Frame-Options: DENY` on everything, and the stage
    // is an iframe — so a component preview rendered as a broken document until
    // this line, exactly as the page preview did before it (site.controller).
    ctx.res.setHeader("x-frame-options", "SAMEORIGIN");
    html(ctx, 200, body);
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
    return this.actOn(ctx, { page: keyOf(ctx) });
  }

  @Post("/components/:key")
  async actOnComponent(ctx: Ctx): Promise<void> {
    return this.actOn(ctx, { component: keyOf(ctx) });
  }

  private async actOn(ctx: Ctx, target: EditTarget): Promise<void> {
    const spec = await this.specs.execute();
    const subject = spec ? subjectOf(spec, target) : undefined;
    if (!spec || !subject) return notFound(ctx);

    const body = (ctx.body ?? {}) as Record<string, unknown>;
    // `up:0-1` — the verb and the block it names, in one form value.
    const [op, at] = String(body["op"] ?? "").split(":");
    const path = parsePath(at ?? body["block"]);
    const actor = ctx.require("actor").email;
    const role = roleOf(ctx.require("actor").role);

    const result = await (async () => {
      switch (op) {
        case "up":
          return path ? this.edits.move(spec, target, path, -1, { actor, role }) : refuse();
        case "down":
          return path ? this.edits.move(spec, target, path, 1, { actor, role }) : refuse();
        case "nest":
          return path ? this.edits.nest(spec, target, path, { actor, role }) : refuse();
        case "unnest":
          return path ? this.edits.unnest(spec, target, path, { actor, role }) : refuse();
        case "dup":
          return path ? this.edits.duplicate(spec, target, path, { actor, role }) : refuse();
        case "del":
          // Confirmed by construction: the button says delete, and the gate
          // still refuses if the classifier decides content is lost.
          return path ? this.edits.remove(spec, target, path, { actor, role }) : refuse();
        case "publish":
        case "unpublish":
          return "page" in target
            ? this.edits.setPublished(spec, target.page, op === "publish", { actor, role })
            : { ok: false as const, error: "A component is published with the pages that use it." };
        case "component":
          // Lift the selected section out into a reusable component, and leave
          // an instance of it behind (ADR 0022 §2).
          return path
            ? this.edits.saveAsComponent(spec, target, path, String(body["name"] ?? ""), {
                actor,
                role,
              })
            : refuse();
        case "add": {
          // The palette sends `component:cta` for a reusable one, a plain block
          // name otherwise — one select, because to the person adding it they
          // are the same choice.
          const [type, use] = String(body["type"] ?? "text").split(":");
          return this.edits.add(
            spec,
            target,
            path,
            type ?? "text",
            { actor, role },
            // A component block means nothing without the component it places.
            type === "component" && use ? { use } : undefined,
          );
        }
        case "to": {
          // From a drag: the block and where it landed among its siblings.
          const to = Number(body["to"]);
          return path && Number.isInteger(to)
            ? this.edits.reorder(spec, target, path, to, { actor, role })
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

    redirect(ctx, `${subject.base}${suffix}`);
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
    return this.setTextOn(ctx, { page: keyOf(ctx) });
  }

  @Post("/components/:key/text")
  async setComponentText(ctx: Ctx): Promise<void> {
    return this.setTextOn(ctx, { component: keyOf(ctx) });
  }

  private async setTextOn(ctx: Ctx, target: EditTarget): Promise<void> {
    const spec = await this.specs.execute();
    if (!spec || !subjectOf(spec, target)) return notFound(ctx);

    const body = ctx.body as Record<string, unknown>;
    const path = parsePath(body["path"]);
    if (!path) return json(ctx, 400, { error: "No block." });

    const result = await this.edits.setText(spec, target, path, String(body["text"] ?? ""), {
      actor: ctx.require("actor").email,
      role: roleOf(ctx.require("actor").role),
    });

    json(ctx, result.ok ? 200 : 409, result.ok ? { ok: true } : { error: result.error });
  }

  /** The inspector's save: attributes and tier-2 style for one block. */
  @Post("/pages/:key/style")
  async style(ctx: Ctx): Promise<void> {
    return this.styleOn(ctx, { page: keyOf(ctx) });
  }

  @Post("/components/:key/style")
  async styleComponent(ctx: Ctx): Promise<void> {
    return this.styleOn(ctx, { component: keyOf(ctx) });
  }

  private async styleOn(ctx: Ctx, target: EditTarget): Promise<void> {
    const spec = await this.specs.execute();
    const subject = spec ? subjectOf(spec, target) : undefined;
    if (!spec || !subject) return notFound(ctx);

    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const path = parsePath(body["path"]);
    if (!path) return redirect(ctx, subject.base);

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
      target,
      path,
      { attrs, style },
      { actor: ctx.require("actor").email, role: roleOf(ctx.require("actor").role) },
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
    redirect(ctx, `${subject.base}${query}`);
  }
}

/**
 * What the panel says about a placed component.
 *
 * Not a properties panel: an instance has no properties. It has one attribute
 * naming what to place, and the only useful action from here is to go and edit
 * the thing itself — which is the honest answer, because editing it here would
 * have to mean editing it everywhere.
 */
function componentPanel(use: string, spec: SiteSpec): string {
  const component = spec.components.find((c) => c.key === use);
  if (!component) {
    return `<p class="error">This places a component called "${esc(use)}", which no longer exists.</p>`;
  }
  const places = spec.pages.filter((p) => placesComponent(p.blocks, use)).length;
  return `<h3>${esc(component.label ?? component.key)}</h3>
<p class="help">A component, placed here. It appears on ${places} page${places === 1 ? "" : "s"}; editing it changes all of them.</p>
<p><a href="/admin/components/${esc(component.key)}">Edit this component →</a></p>`;
}

/** True when a block tree places this component anywhere inside it. */
function placesComponent(blocks: readonly Block[], use: string): boolean {
  return blocks.some(
    (b) =>
      (b.type === "component" && (b.attrs ?? {})["use"] === use) ||
      placesComponent(b.children ?? [], use) ||
      placesComponent(b.item ?? [], use),
  );
}

/** The `:key` segment, whichever route matched. */
function keyOf(ctx: Ctx): string {
  return String((ctx.params as Record<string, string>)["key"] ?? "");
}

/**
 * What the canvas is editing, as the canvas needs it.
 *
 * A component is presented as a page so the view, the tree and the inspector
 * stay one implementation — it has blocks, a name and no URL, and those are the
 * only three things they read. `base` is where every form posts, which is the
 * one thing that genuinely differs between the two.
 */
function subjectOf(
  spec: SiteSpec,
  target: EditTarget,
): { page: Page; base: string; component?: true } | undefined {
  if ("page" in target) {
    const page = spec.pages.find((p) => p.key === target.page);
    return page ? { page, base: `/admin/pages/${target.page}` } : undefined;
  }

  const component = spec.components.find((c) => c.key === target.component);
  if (!component) return undefined;
  return {
    page: {
      key: component.key,
      title: component.label ?? component.key,
      path: `/admin/components/${component.key}`,
      blocks: component.blocks,
    } as Page,
    base: `/admin/components/${component.key}`,
    component: true,
  };
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
