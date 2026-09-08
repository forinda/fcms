/**
 * The site's own settings, its theme, and its pages (ADR 0035).
 *
 * Every route produces a whole spec and applies it, like every other builder —
 * so a colour changed here is a line in history with an actor and an undo, the
 * same as one changed in YAML.
 */
import { Controller, Get, Inject, Post, type Ctx } from "@forinda/kickjs";

import { SiteSpecUseCase } from "@/shared/use-cases";
import { PageManageUseCase, type EditResult as PageResult } from "./use-cases/page-manage.usecase";
import { SiteEditUseCase, tokenUsage, type TokenGroup } from "./use-cases/site-edit.usecase";
import { html, notFound, redirect } from "./utils/http";
import { pageList, pageSettings } from "./utils/pages.view";
import { settings } from "./utils/settings.view";
import { page } from "./utils/view";

const GROUPS: readonly TokenGroup[] = ["colors", "typeScale", "radius"];

@Controller()
export class SettingsController {
  @Inject(SiteSpecUseCase) private readonly specs!: SiteSpecUseCase;
  @Inject(SiteEditUseCase) private readonly site!: SiteEditUseCase;
  @Inject(PageManageUseCase) private readonly pages!: PageManageUseCase;

  @Get("/settings")
  async show(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    if (!spec) return notFound(ctx);

    // Counted here rather than in the view: "used in 3 places" is what makes
    // the remove button safe to press or refuse to appear at all.
    const usage: Record<string, { count: number; base: boolean }> = {};
    for (const group of GROUPS) {
      for (const name of Object.keys(spec.theme[group] ?? {})) {
        usage[`${group}.${name}`] = tokenUsage(spec, group, name);
      }
    }

    html(
      ctx,
      200,
      page({
        title: "Settings",
        trail: [{ label: "Settings" }],
        section: "settings",
        body: settings({ spec, usage, error: error(ctx) }),
      }),
    );
  }

  @Post("/settings")
  async save(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    if (!spec) return notFound(ctx);

    const body = form(ctx);
    const tokens = { colors: {}, typeScale: {}, radius: {} } as Record<
      TokenGroup,
      Record<string, string>
    >;
    for (const [field, value] of Object.entries(body)) {
      const parts = field.split("__");
      if (parts[0] !== "token" || parts.length < 3) continue;
      const group = parts[1] as TokenGroup;
      if (GROUPS.includes(group)) tokens[group]![parts.slice(2).join("__")] = str(value);
    }

    const result = await this.site.update(
      spec,
      {
        name: str(body["name"]),
        fonts: {
          body: str(body["fontBody"]),
          heading: str(body["fontHeading"]),
          mono: str(body["fontMono"]),
        },
        tokens,
      },
      { actor: actor(ctx) },
    );

    redirect(ctx, result.ok ? "/admin/settings" : withError("/admin/settings", result));
  }

  /** Adding a token, and removing one — one form, the way the builders do it. */
  @Post("/settings/tokens")
  async tokens(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    if (!spec) return notFound(ctx);

    const body = form(ctx);
    const [op, group, name] = str(body["op"]).split(":");
    const input = { actor: actor(ctx) };

    const result =
      op === "add"
        ? await this.site.addToken(
            spec,
            (str(body["group"]) as TokenGroup) || "colors",
            str(body["name"]),
            str(body["value"]),
            input,
          )
        : op === "remove" && GROUPS.includes(group as TokenGroup)
          ? await this.site.removeToken(spec, group as TokenGroup, String(name), input)
          : ({ ok: false, error: "Nothing to do." } as const);

    redirect(ctx, result.ok ? "/admin/settings" : withError("/admin/settings", result));
  }

  @Get("/pages")
  async pageIndex(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    if (!spec) return notFound(ctx);

    html(
      ctx,
      200,
      page({
        title: "Pages",
        trail: [{ label: "Pages" }],
        section: "pages",
        body: pageList({ spec, error: error(ctx) }),
      }),
    );
  }

  @Post("/pages")
  async createPage(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    if (!spec) return notFound(ctx);

    const body = form(ctx);
    const key = str(body["key"]).trim();
    const result = await this.pages.create(spec, key, str(body["title"]), str(body["path"]), {
      actor: actor(ctx),
    });

    // Straight to the canvas: a page that starts empty is not finished until
    // something is on it, and that is the next screen either way.
    redirect(
      ctx,
      result.ok ? `/admin/pages/${encodeURIComponent(key)}` : withError("/admin/pages", result),
    );
  }

  @Get("/pages/:key/settings")
  async pageShow(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = keyOf(ctx);
    const found = spec?.pages.find((p) => p.key === key);
    if (!spec || !found) return notFound(ctx);

    html(
      ctx,
      200,
      page({
        title: `${found.title} — page`,
        trail: [{ label: "Pages", href: "/admin/pages" }, { label: found.title }],
        section: "pages",
        body: pageSettings({
          spec,
          page: found,
          confirm: (ctx.query as Record<string, unknown>)["confirm"] === "yes",
          error: error(ctx),
        }),
      }),
    );
  }

  @Post("/pages/:key/settings")
  async pageSave(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = keyOf(ctx);
    if (!spec) return notFound(ctx);

    const body = form(ctx);
    const result = await this.pages.update(
      spec,
      key,
      {
        title: str(body["title"]),
        path: str(body["path"]),
        draft: str(body["draft"]) === "on",
        collection: str(body["collection"]) || undefined,
        seoTitle: str(body["seoTitle"]),
        seoDescription: str(body["seoDescription"]),
        noindex: str(body["noindex"]) === "on",
        bare: str(body["bare"]) === "on",
      },
      { actor: actor(ctx) },
    );

    this.backToPage(ctx, key, result);
  }

  @Post("/pages/:key/delete")
  async pageDelete(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = keyOf(ctx);
    if (!spec) return notFound(ctx);

    // The gate refuses the first press and says what it costs; the message is
    // rendered with the button that goes ahead (ADR 0033 §5).
    const result = await this.pages.remove(spec, key, {
      actor: actor(ctx),
      allowDestructive: str(form(ctx)["confirm"]) === "yes",
    });

    if (result.ok) return redirect(ctx, "/admin/pages");
    redirect(
      ctx,
      `/admin/pages/${encodeURIComponent(key)}/settings?confirm=yes&error=${encodeURIComponent(result.error)}`,
    );
  }

  private backToPage(ctx: Ctx, key: string, result: PageResult): void {
    const at = `/admin/pages/${encodeURIComponent(key)}/settings`;
    redirect(ctx, result.ok ? at : withError(at, result));
  }
}

const keyOf = (ctx: Ctx): string => String((ctx.params as Record<string, string>)["key"] ?? "");
const actor = (ctx: Ctx): string => ctx.require("actor").email;
const form = (ctx: Ctx): Record<string, unknown> => (ctx.body ?? {}) as Record<string, unknown>;
const error = (ctx: Ctx): string | undefined => {
  const asked = (ctx.query as Record<string, unknown>)["error"];
  return typeof asked === "string" ? asked : undefined;
};

const withError = (at: string, result: { ok: boolean; error?: string }): string =>
  result.ok ? at : `${at}?error=${encodeURIComponent(result.error ?? "")}`;

/** The last value wins, which is how a checkbox's hidden `off` pair is read. */
const str = (value: unknown): string =>
  typeof value === "string" ? value : Array.isArray(value) ? str(value[value.length - 1]) : "";
