/**
 * Content screens: types, entries, and the spec's history.
 *
 * ADR 0002 scopes the Phase 0b admin to "CRUD over content types, entries,
 * pages, media — forms over spec, no canvas". Two of those are deliberately not
 * here, and both are named on the dashboard rather than quietly missing:
 *
 *   - **Pages** are a block tree. Editing one in a form is worse than not
 *     editing it, so pages are listed and linked to the live site, and the
 *     canvas is Phase 1 (doc 07).
 *   - **Media** needs the asset store, which ADR 0010 puts in Phase 1+.
 *
 * Every route here is inside the deny-by-default tree (ADR 0008 §4) — there is
 * no `auth.public` flag in this file, which is what makes that true rather than
 * asserted.
 */
import { Controller, Get, Inject, Post, type Ctx } from "@forinda/kickjs";
import type { ContentType } from "@forinda-cms/spec";

import { EntryReadUseCase, SiteSpecUseCase } from "@/shared/use-cases";
import { EntryWriteUseCase } from "./use-cases/entries.usecase";
import { SiteHistoryUseCase } from "./use-cases/site-history.usecase";
import { UndoSpecUseCase } from "./use-cases/undo-spec.usecase";
import { html, notFound, readForm, redirect } from "./utils/http";
import { entryForm, esc, page } from "./utils/view";

@Controller()
export class ContentController {
  // One use-case per thing this screen does, each resolved for this request.
  // The controller reads none of them from a repository: a repository in a
  // controller is the data layer leaking into HTTP, and it is what made these
  // screens untestable without a server.
  @Inject(SiteSpecUseCase) private readonly specs!: SiteSpecUseCase;
  @Inject(EntryReadUseCase) private readonly reader!: EntryReadUseCase;
  @Inject(EntryWriteUseCase) private readonly writer!: EntryWriteUseCase;
  @Inject(SiteHistoryUseCase) private readonly changes!: SiteHistoryUseCase;
  @Inject(UndoSpecUseCase) private readonly undoLast!: UndoSpecUseCase;

  /** Types, their row counts, and what is deliberately absent. */
  @Get("/")
  async dashboard(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    if (!spec) return html(ctx, 200, page({ title: "Admin", body: "<p>No site yet.</p>" }));

    const counts = await this.reader.counts(spec);
    const stored = spec.content.filter((t) => !t.derived);
    const derived = spec.content.filter((t) => t.derived);

    const card = (t: ContentType) =>
      `<a class="card" href="/admin/content/${esc(t.key)}">
        <h3>${esc(t.labelPlural ?? t.label)}</h3>
        <p class="muted">${counts[t.key] ?? 0} ${(counts[t.key] ?? 0) === 1 ? "entry" : "entries"}</p>
      </a>`;

    html(
      ctx,
      200,
      page({
        title: `${spec.name} — Admin`,
        body: `<h1>${esc(spec.name)}</h1>
<p class="muted">${spec.pages.length} pages · <a href="/admin/history">history</a></p>

<h2>Content</h2>
<div class="cards">${stored.map(card).join("")}</div>
${
  derived.length
    ? `<h2>Computed</h2>
<p class="muted">Worked out from other content rather than stored, so there is nothing to edit.</p>
<div class="cards">${derived
        .map(
          (t) =>
            `<div class="card"><h3>${esc(t.labelPlural ?? t.label)}</h3><p class="muted">computed</p></div>`,
        )
        .join("")}</div>`
    : ""
}

<h2>Pages</h2>
<p class="muted">Pages are a tree of blocks — edited on the canvas, where the page you
are changing is the page you are looking at.</p>
<table><tbody>${spec.pages
          .map(
            (p) =>
              `<tr><td>${esc(p.title)}</td><td class="muted">${esc(p.path)}</td>
               <td><a href="/admin/pages/${esc(p.key)}">edit</a> ·
                   <a href="${esc(p.path)}">view</a></td></tr>`,
          )
          .join("")}</tbody></table>`,
      }),
    );
  }

  @Get("/content/:type")
  async list(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = String((ctx.params as Record<string, string>)["type"] ?? "");
    const type = spec?.content.find((t) => t.key === key);
    if (!spec || !type) return notFound(ctx);

    const rows = await this.reader.rows(key);
    const title = (data: Record<string, unknown>) =>
      String(data[type.titleField ?? "name"] ?? data["title"] ?? "—");

    html(
      ctx,
      200,
      page({
        title: `${type.labelPlural ?? type.label} — Admin`,
        trail: [{ label: type.labelPlural ?? type.label }],
        body: `<h1>${esc(type.labelPlural ?? type.label)}</h1>
${
  type.derived
    ? `<p class="muted">Computed from other content, so there is nothing to edit here.</p>`
    : `<p><a href="/admin/content/${esc(key)}/new">Add ${esc(type.label.toLowerCase())}</a></p>`
}
${
  rows.length === 0
    ? `<p class="muted">Nothing yet.</p>`
    : `<table>
  <thead><tr><th>${esc(type.label)}</th><th>Slug</th><th>Status</th><th></th></tr></thead>
  <tbody>${rows
    .map(
      (r) => `<tr>
      <td>${esc(title(r.data))}</td>
      <td class="muted">${esc(r.slug ?? "")}</td>
      <td><span class="pill">${esc(r.status)}</span></td>
      <td>${type.derived ? "" : `<a href="/admin/content/${esc(key)}/${esc(r.id)}">edit</a>`}</td>
    </tr>`,
    )
    .join("")}</tbody></table>`
}`,
      }),
    );
  }

  @Get("/content/:type/new")
  async createForm(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = String((ctx.params as Record<string, string>)["type"] ?? "");
    const type = spec?.content.find((t) => t.key === key);
    if (!type || type.derived) return notFound(ctx);

    html(
      ctx,
      200,
      page({
        title: `New ${type.label}`,
        trail: [
          { label: type.labelPlural ?? type.label, href: `/admin/content/${key}` },
          { label: `New ${type.label.toLowerCase()}` },
        ],
        body: `<h1>New ${esc(type.label.toLowerCase())}</h1>
${entryForm(type, {}, { action: `/admin/content/${key}/new` })}`,
      }),
    );
  }

  @Post("/content/:type/new")
  async create(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = String((ctx.params as Record<string, string>)["type"] ?? "");
    const type = spec?.content.find((t) => t.key === key);
    if (!spec || !type) return notFound(ctx);

    const { slug, data } = readForm(ctx, type);
    const result = await this.writer.create(spec, { typeKey: key, slug, data });

    if (result.ok) return redirect(ctx, `/admin/content/${key}`);

    // Re-rendered with what they typed, not a blank form. Losing a filled-in
    // form to a validation error is the fastest way to lose someone's trust in
    // an admin.
    html(
      ctx,
      422,
      page({
        title: `New ${type.label}`,
        trail: [
          { label: type.labelPlural ?? type.label, href: `/admin/content/${key}` },
          { label: "New" },
        ],
        body: `<h1>New ${esc(type.label.toLowerCase())}</h1>
${entryForm(type, data, { action: `/admin/content/${key}/new`, slug, errors: result.errors })}`,
      }),
    );
  }

  @Get("/content/:type/:id")
  async editForm(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const params = ctx.params as Record<string, string>;
    const type = spec?.content.find((t) => t.key === params["type"]);
    if (!type || type.derived) return notFound(ctx);

    const entry = await this.reader.byId(String(params["id"]));
    if (!entry) return notFound(ctx);

    html(
      ctx,
      200,
      page({
        title: `Edit ${type.label}`,
        trail: [
          { label: type.labelPlural ?? type.label, href: `/admin/content/${type.key}` },
          { label: "Edit" },
        ],
        body: `<h1>Edit ${esc(type.label.toLowerCase())}</h1>
${entryForm(type, entry.data, {
  action: `/admin/content/${type.key}/${entry.id}`,
  slug: entry.slug,
  deleteAction: `/admin/content/${type.key}/${entry.id}/delete`,
})}`,
      }),
    );
  }

  @Post("/content/:type/:id")
  async update(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const params = ctx.params as Record<string, string>;
    const type = spec?.content.find((t) => t.key === params["type"]);
    if (!spec || !type) return notFound(ctx);

    const id = String(params["id"]);
    const { slug, data } = readForm(ctx, type);
    const result = await this.writer.update(spec, id, { typeKey: type.key, slug, data });

    if (result.ok) return redirect(ctx, `/admin/content/${type.key}`);

    html(
      ctx,
      422,
      page({
        title: `Edit ${type.label}`,
        trail: [
          { label: type.labelPlural ?? type.label, href: `/admin/content/${type.key}` },
          { label: "Edit" },
        ],
        body: `<h1>Edit ${esc(type.label.toLowerCase())}</h1>
${entryForm(type, data, {
  action: `/admin/content/${type.key}/${id}`,
  slug,
  errors: result.errors,
  deleteAction: `/admin/content/${type.key}/${id}/delete`,
})}`,
      }),
    );
  }

  @Post("/content/:type/:id/delete")
  async remove(ctx: Ctx): Promise<void> {
    const params = ctx.params as Record<string, string>;
    await this.writer.delete(String(params["id"]));
    redirect(ctx, `/admin/content/${params["type"]}`);
  }

  /**
   * What has happened to this site, and the undo button.
   *
   * Doc 13's argument that review can move to a non-developer rests on a wrong
   * "yes" being cheap to reverse. This is where that stops being a property of
   * the schema and becomes something a person can actually press.
   */
  @Get("/history")
  async history(ctx: Ctx): Promise<void> {
    const entries = await this.changes.execute(50);

    html(
      ctx,
      200,
      page({
        title: "History",
        trail: [{ label: "History" }],
        body: `<h1>History</h1>
${
  entries.length === 0
    ? `<p class="muted">Nothing has changed yet.</p>`
    : `<form method="post" action="/admin/history/undo">
  <button type="submit">Undo the last change</button>
</form>
<table>
  <thead><tr><th>#</th><th>What changed</th><th>Who</th><th>Where from</th></tr></thead>
  <tbody>${entries
    .map(
      (e) => `<tr${e.revertedAt ? ' class="muted"' : ""}>
      <td>${e.seq}</td>
      <td>${esc(e.summary)}
        ${e.classification === "destructive" ? `<span class="pill destructive">destructive</span>` : ""}
        ${e.revertedAt ? `<span class="pill">undone</span>` : ""}</td>
      <td>${esc(e.actor)}</td>
      <td class="muted">${esc(e.harness ? `${e.source} · ${e.harness}` : e.source)}</td>
    </tr>`,
    )
    .join("")}</tbody></table>`
}`,
      }),
    );
  }

  @Post("/history/undo")
  async undo(ctx: Ctx): Promise<void> {
    await this.undoLast.execute();
    redirect(ctx, "/admin/history");
  }
}
