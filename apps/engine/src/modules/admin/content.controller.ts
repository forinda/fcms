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
import { Controller, Get, getEnv, Inject, Post, type Ctx } from "@forinda/kickjs";

import { atLeast, refusal, roleOf, type Role } from "@/shared/roles";
import type { ContentType, SiteSpec } from "@forinda-cms/spec";

import { EntryReadUseCase, SiteSpecUseCase } from "@/shared/use-cases";
import { PaymentRepository, PaymentUseCase, PROVIDERS } from "@/shared/payments";
import { WorkflowUseCase } from "@/shared/workflows/workflow.usecase";
import { EntryWriteUseCase } from "./use-cases/entries.usecase";
import { MediaUseCase } from "./use-cases/media.usecase";
import { SiteHistoryUseCase } from "./use-cases/site-history.usecase";
import { UndoSpecUseCase } from "./use-cases/undo-spec.usecase";
import { html, noSiteYet, notFound, readForm, redirect } from "./utils/http";
import { STARTERS } from "@/shared/starters";
import { dashboard } from "./utils/dashboard.view";
import { entryList } from "./utils/entries.view";
import { firstRun, untouched } from "./utils/first-run.view";
import { entryForm, esc, page, type FieldChoices } from "./utils/view";

/**
 * A screenful.
 *
 * Twenty-five is enough to scan and small enough to render on a phone on a
 * slow connection, which is the machine doc 14 says half this audience is on.
 */
const PER_PAGE = 25;

const SORTS = ["newest", "oldest", "updated", "title"] as const;
type Sort = (typeof SORTS)[number];

/** The last value wins, and a missing one is an empty string, never undefined. */
const str = (value: unknown): string =>
  typeof value === "string" ? value : Array.isArray(value) ? str(value[value.length - 1]) : "";

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
  @Inject(PaymentRepository) private readonly payments!: PaymentRepository;
  @Inject(PaymentUseCase) private readonly pay!: PaymentUseCase;
  @Inject(WorkflowUseCase) private readonly workflows!: WorkflowUseCase;
  @Inject(MediaUseCase) private readonly media!: MediaUseCase;

  /**
   * What wants a person, then what has happened, then everything else.
   *
   * Five reads rather than one, because "nothing is waiting" has to be true
   * about the whole site to be worth saying — a dashboard that only knew about
   * drafts would say it while an automation was failing every ten minutes.
   */
  @Get("/")
  async dashboard(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    // A site nobody has started yet is not an error and not an empty page: it
    // is the one moment where the only useful screen is "what kind of site is
    // this" (ADR 0036). Boot applies the blank starter so the install reaches
    // a working site, so "no spec at all" is the rarer of the two states.
    if (!spec || untouched(spec)) {
      const asked = (ctx.query as Record<string, unknown>)["error"];
      return html(
        ctx,
        200,
        page({
          title: "Welcome",
          body: firstRun({
            siteName: spec?.name ?? getEnv("SITE_NAME") ?? "This site",
            starters: STARTERS,
            error: typeof asked === "string" ? asked : undefined,
          }),
        }),
      );
    }

    const [counts, drafts, runs, payments, history] = await Promise.all([
      this.reader.counts(spec),
      this.reader.drafts(),
      this.workflows.recent(20),
      this.payments.recent(20),
      this.changes.execute(5),
    ]);

    html(
      ctx,
      200,
      page({
        role: viewerRole(ctx),
        title: `${spec.name} — Admin`,
        body: dashboard({ spec, counts, drafts, runs, payments, history }),
      }),
    );
  }

  /**
   * A page of one type's entries, filtered and ordered (ADR 0037).
   *
   * Everything the screen offers is a query parameter, so a filtered list is a
   * URL — bookmarkable, shareable, and something the dashboard can link
   * straight into ("8 bookings not published" goes to the drafts).
   */
  @Get("/content/:type")
  async list(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = String((ctx.params as Record<string, string>)["type"] ?? "");
    const type = spec?.content.find((t) => t.key === key);
    if (!spec) return noSiteYet(ctx);
    if (!type) return notFound(ctx);

    const query = ctx.query as Record<string, unknown>;
    const search = str(query["q"]).trim();
    const status =
      str(query["status"]) === "draft"
        ? "draft"
        : str(query["status"]) === "published"
          ? "published"
          : "";
    const sort = SORTS.includes(str(query["sort"]) as Sort)
      ? (str(query["sort"]) as Sort)
      : "newest";
    const pageNumber = Math.max(1, Number.parseInt(str(query["page"]), 10) || 1);

    const { rows, total } = await this.reader.page(key, {
      search,
      status: status === "" ? undefined : status,
      sort,
      // Only fields that hold words: a search over a number or a boolean
      // matches nothing anybody typed.
      searchable: type.fields
        .filter((f) => ["text", "richtext", "email", "phone", "url"].includes(f.type))
        .map((f) => f.name),
      titleField: type.titleField ?? "name",
      limit: PER_PAGE,
      offset: (pageNumber - 1) * PER_PAGE,
    });

    html(
      ctx,
      200,
      page({
        role: viewerRole(ctx),
        title: `${type.labelPlural ?? type.label} — Admin`,
        trail: [{ label: type.labelPlural ?? type.label }],
        body: entryList({
          type,
          rows,
          total,
          page: pageNumber,
          perPage: PER_PAGE,
          search,
          status,
          sort,
        }),
      }),
    );
  }

  /**
   * What the form's pickers offer: the rows a reference can point at, and the
   * files in the library.
   *
   * Read per request rather than cached, because the answer changes whenever
   * somebody adds a service or uploads a picture — and a stale picker is a
   * picker that cannot choose the thing you just made.
   *
   * ponytail: capped at 200 rows per type. A site with more services than that
   * needs a picker that searches, which is a different control, not a bigger
   * number.
   */
  private async choicesFor(spec: SiteSpec, type: ContentType): Promise<FieldChoices> {
    const references: Record<string, { value: string; label: string }[]> = {};

    for (const field of type.fields) {
      if (field.type !== "reference" || !("to" in field)) continue;
      const target = spec.content.find((t) => t.key === field.to);
      if (!target || references[field.to]) continue;

      const { rows } = await this.reader.page(field.to, {
        sort: "title",
        titleField: target.titleField ?? "name",
        limit: 200,
        offset: 0,
      });

      references[field.to] = rows
        // A reference is `ref:type/slug`, so a row without a slug cannot be
        // pointed at — offering it would write a reference that resolves to
        // nothing.
        .filter((row) => row.slug)
        .map((row) => ({
          value: `ref:${field.to}/${row.slug}`,
          label: `${String(row.data[target.titleField ?? "name"] ?? row.slug)}${
            row.status === "draft" ? " (draft)" : ""
          }`,
        }));
    }

    const wantsAssets = type.fields.some((f) => f.type === "asset");
    const assets = wantsAssets
      ? (await this.media.list()).map((asset) => ({
          value: `asset:${asset.id}`,
          label: `${asset.alt || asset.filename}`,
          image: asset.contentType.startsWith("image/"),
          id: asset.id,
        }))
      : [];

    return { references, assets };
  }

  /**
   * Publish or unpublish one entry.
   *
   * The action that decides whether the public site can see it. It is not a
   * spec change, so it does not go through the patch spine — content is data,
   * and the row's own timestamp is its history.
   */
  @Post("/content/:type/:id/status")
  async setStatus(ctx: Ctx): Promise<void> {
    const refused = mayWrite(ctx);
    if (refused)
      return html(
        ctx,
        403,
        page({
          role: roleOf(ctx.require("actor").role),
          title: "Not allowed",
          body: `<h1>Not allowed</h1><p class="error" role="alert">${esc(refused)}</p>`,
        }),
      );

    const params = ctx.params as Record<string, string>;
    const body = ctx.body as Record<string, unknown>;
    const status = body["status"] === "published" ? "published" : "draft";

    await this.writer.setStatus(String(params["id"]), status);
    redirect(ctx, `/admin/content/${String(params["type"])}`);
  }

  @Get("/content/:type/new")
  async createForm(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = String((ctx.params as Record<string, string>)["type"] ?? "");
    const type = spec?.content.find((t) => t.key === key);
    if (!spec || !type || type.derived) return notFound(ctx);

    const choices = await this.choicesFor(spec, type);

    html(
      ctx,
      200,
      page({
        role: viewerRole(ctx),
        title: `New ${type.label}`,
        trail: [
          { label: type.labelPlural ?? type.label, href: `/admin/content/${key}` },
          { label: `New ${type.label.toLowerCase()}` },
        ],
        body: `<h1>New ${esc(type.label.toLowerCase())}</h1>
${entryForm(type, {}, { action: `/admin/content/${key}/new`, choices })}`,
      }),
    );
  }

  @Post("/content/:type/new")
  async create(ctx: Ctx): Promise<void> {
    const refused = mayWrite(ctx);
    if (refused)
      return html(
        ctx,
        403,
        page({
          role: roleOf(ctx.require("actor").role),
          title: "Not allowed",
          body: `<h1>Not allowed</h1><p class="error" role="alert">${esc(refused)}</p>`,
        }),
      );

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
        role: viewerRole(ctx),
        title: `New ${type.label}`,
        trail: [
          { label: type.labelPlural ?? type.label, href: `/admin/content/${key}` },
          { label: "New" },
        ],
        body: `<h1>New ${esc(type.label.toLowerCase())}</h1>
${entryForm(type, data, {
  action: `/admin/content/${key}/new`,
  slug,
  errors: result.errors,
  choices: await this.choicesFor(spec, type),
})}`,
      }),
    );
  }

  @Get("/content/:type/:id")
  async editForm(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const params = ctx.params as Record<string, string>;
    const type = spec?.content.find((t) => t.key === params["type"]);
    if (!spec || !type || type.derived) return notFound(ctx);

    const entry = await this.reader.byId(String(params["id"]));
    if (!entry) return notFound(ctx);

    html(
      ctx,
      200,
      page({
        role: viewerRole(ctx),
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
  choices: await this.choicesFor(spec, type),
})}
${paymentsPanel(await this.payments.forEntry(entry.id), `/admin/content/${type.key}/${entry.id}`)}`,
      }),
    );
  }

  @Post("/content/:type/:id")
  async update(ctx: Ctx): Promise<void> {
    const refused = mayWrite(ctx);
    if (refused)
      return html(
        ctx,
        403,
        page({
          role: roleOf(ctx.require("actor").role),
          title: "Not allowed",
          body: `<h1>Not allowed</h1><p class="error" role="alert">${esc(refused)}</p>`,
        }),
      );

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
        role: viewerRole(ctx),
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
  choices: await this.choicesFor(spec, type),
})}`,
      }),
    );
  }

  /**
   * "The money arrived."
   *
   * The only way a `payment.manual` charge settles, because there is nobody to
   * ask — cash in a salon is confirmed by the person who took it (ADR 0023 §5).
   * Deliberately not available for a provider that can be asked: an owner
   * marking an M-Pesa payment paid by hand would be overriding the provider.
   */
  @Post("/content/:type/:id/paid")
  async settle(ctx: Ctx): Promise<void> {
    const refused = mayWrite(ctx);
    if (refused)
      return html(
        ctx,
        403,
        page({
          role: roleOf(ctx.require("actor").role),
          title: "Not allowed",
          body: `<h1>Not allowed</h1><p class="error" role="alert">${esc(refused)}</p>`,
        }),
      );

    const params = ctx.params as Record<string, string>;
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const payment = await this.payments.byId(String(body["payment"] ?? ""));

    if (payment && payment.provider === "payment.manual") {
      const spec = await this.specs.execute();
      await this.pay.settleManually(payment, ctx.require("actor").email, spec ?? undefined);
    }

    redirect(ctx, `/admin/content/${params["type"]}/${params["id"]}`);
  }

  @Post("/content/:type/:id/delete")
  async remove(ctx: Ctx): Promise<void> {
    const refused = mayWrite(ctx);
    if (refused)
      return html(
        ctx,
        403,
        page({
          role: roleOf(ctx.require("actor").role),
          title: "Not allowed",
          body: `<h1>Not allowed</h1><p class="error" role="alert">${esc(refused)}</p>`,
        }),
      );

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
  /**
   * What the automations have been doing (ADR 0024 §3).
   *
   * The screen that makes a runner honest. "Text me when someone books" failing
   * quietly is this feature's worst outcome, so every run — done, waiting to be
   * retried, or given up on — is a row here with the reason on it.
   */
  @Get("/automations")
  async automations(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const runs = await this.workflows.recent(50);
    const declared = spec?.logic ?? [];

    html(
      ctx,
      200,
      page({
        role: viewerRole(ctx),
        title: "Automations",
        trail: [{ label: "Automations" }],
        body: `<h1>Automations</h1>
${
  declared.length === 0
    ? `<p class="muted">This site has no automations yet.</p>`
    : `<table>
  <thead><tr><th>Automation</th><th>Runs when</th><th>Steps</th><th></th></tr></thead>
  <tbody>${declared
    .map(
      (w) => `<tr><td><a href="/admin/automations/${esc(w.key)}">${esc(w.key)}</a>${
        w.enabled === false ? ' <span class="pill">off</span>' : ""
      }</td>
      <td class="muted">${esc(w.trigger.on)}</td><td class="muted">${w.steps.length}</td>
      <td><form method="post" action="/admin/automations/${esc(w.key)}/test" class="inline">
        <button type="submit">Try it</button>
      </form></td></tr>`,
    )
    .join("")}</tbody></table>`
}
<form method="post" action="/admin/automations" class="new-automation">
  <h2>New automation</h2>
  <div class="row">
    <input name="key" placeholder="tell-the-kitchen" required>
    <select name="on">
      <option value="entry.created">when something is created</option>
      <option value="entry.updated">when something changes</option>
      <option value="entry.transitioned">when something changes status</option>
      <option value="payment.succeeded">when a payment succeeds</option>
      <option value="schedule">on a schedule</option>
    </select>
    <select name="type">
      ${(spec?.content ?? [])
        .filter((t) => !t.derived)
        .map((t) => `<option value="${esc(t.key)}">${esc(t.label)}</option>`)
        .join("")}
    </select>
    <button type="submit">Create</button>
  </div>
  <p class="help">A schedule ignores the type and runs at 9am until you change it.</p>
</form>

<h2>Recent runs</h2>
${
  runs.length === 0
    ? `<p class="muted">Nothing has run yet.</p>`
    : `<table>
  <thead><tr><th>When</th><th>Automation</th><th>Trigger</th><th>Status</th><th>What happened</th></tr></thead>
  <tbody>${runs
    .map(
      (run) => `<tr${run.status === "failed" ? ' class="destructive"' : ""}>
      <td class="muted">${esc(run.createdAt.toISOString().replace("T", " ").slice(0, 16))}</td>
      <td>${esc(run.workflowKey)}</td>
      <td class="muted">${esc(run.trigger)}</td>
      <td>${esc(run.status)}${(run.detail as { test?: boolean } | null)?.test ? ' <span class="pill">test</span>' : ""}${run.attempts > 1 ? ` <span class="pill">${run.attempts} tries</span>` : ""}</td>
      <td class="muted">${esc(run.lastError ?? stepsOf(run.detail))}</td>
    </tr>`,
    )
    .join("")}</tbody></table>`
}`,
      }),
    );
  }

  /**
   * Try an automation without doing it (ADR 0029 §5).
   *
   * Every step that touches the world says what it would have done. The result
   * is a run on the same screen, marked as a test — so the way to find out what
   * an automation does is the way you find out what it did.
   */
  @Post("/automations/:key/test")
  async testAutomation(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = String((ctx.params as Record<string, string>)["key"] ?? "");
    if (!spec) return noSiteYet(ctx);

    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const workflow = spec.logic.find((w) => w.key === key);
    const typeKey = workflow && "type" in workflow.trigger ? workflow.trigger.type : undefined;

    // A trigger about a content type is tried against a real row of it: an
    // automation tested on nothing tells you nothing.
    const entry = typeKey
      ? ((await this.reader.rows(typeKey))[0] ?? null)
      : ((await this.reader.byId(String(body["entry"] ?? ""))) ?? null);

    await this.workflows.test(spec, key, entry?.id ?? null);
    redirect(ctx, "/admin/automations");
  }

  @Get("/history")
  async history(ctx: Ctx): Promise<void> {
    const entries = await this.changes.execute(50);

    html(
      ctx,
      200,
      page({
        role: viewerRole(ctx),
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

/**
 * What was charged for this entry, and the one action an owner has.
 *
 * Shown on the entry rather than on a payments screen of its own: the question
 * an owner has is "did this booking get paid", and the booking is where they
 * are already looking.
 */
function paymentsPanel(
  rows: readonly import("@forinda-cms/db").PaymentRow[],
  base: string,
): string {
  if (rows.length === 0) return "";

  const row = (payment: (typeof rows)[number]) => {
    const amount = `${esc(payment.currency)} ${(payment.amount / 100).toFixed(2)}`;
    const when = payment.paidAt ? payment.paidAt.toISOString().slice(0, 10) : "";
    // Only a provider with nobody to ask can be settled by hand — otherwise an
    // owner would be overriding the provider's own answer.
    const settle =
      payment.status === "pending" && payment.provider === "payment.manual"
        ? `<form method="post" action="${esc(base)}/paid" class="inline">
             <input type="hidden" name="payment" value="${esc(payment.id)}">
             <button type="submit">Mark as paid</button>
           </form>`
        : "";
    const unverified = PROVIDERS[payment.provider]?.unverified
      ? ' <span class="pill">unverified provider</span>'
      : "";

    return `<tr><td>${amount}</td><td>${esc(payment.status)}${unverified}</td>
      <td>${esc(payment.via)}</td><td>${esc(when)}</td><td>${settle}</td></tr>`;
  };

  return `<section class="payments">
  <h2>Payments</h2>
  <table><thead><tr><th>Amount</th><th>Status</th><th>Method</th><th>Paid</th><th></th></tr></thead>
  <tbody>${rows.map(row).join("")}</tbody></table>
</section>`;
}

/** What a run's steps did, on one line. */
function stepsOf(detail: Record<string, unknown> | null): string {
  const steps = detail?.["steps"];
  return Array.isArray(steps) ? steps.join(" · ") : String(detail?.["note"] ?? "");
}

/** The role on the session, for the chrome to hide what it cannot open. */
const viewerRole = (ctx: Ctx): Role => roleOf(ctx.require("actor").role);

/**
 * Everything that writes content needs at least an editor.
 *
 * A viewer can read the site and its spec (ADR 0008 §2) and change nothing —
 * checked at the write rather than by hiding the button, because a hidden
 * button is a decoration and a refused POST is a rule.
 */
function mayWrite(ctx: Ctx): string | null {
  const role = roleOf(ctx.require("actor").role);
  return atLeast(role, "editor") ? null : refusal(role, "change what is on the site");
}
