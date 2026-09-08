/**
 * Defining what the site stores (ADR 0033).
 *
 * Every route here produces a whole spec and applies it, so a type built in a
 * browser lands in the same history, with the same diff, the same undo and the
 * same destructive gate as one written in YAML or proposed by the assistant.
 */
import { Controller, Get, Inject, Post, type Ctx } from "@forinda/kickjs";

import { EntryReadUseCase, SiteSpecUseCase } from "@/shared/use-cases";
import { TypeEditUseCase, type EditResult } from "./use-cases/type-edit.usecase";
import { html, noSiteYet, notFound, redirect } from "./utils/http";
import { typeBuilder, typeList } from "./utils/types.view";
import { page } from "./utils/view";

@Controller()
export class TypesController {
  @Inject(SiteSpecUseCase) private readonly specs!: SiteSpecUseCase;
  @Inject(EntryReadUseCase) private readonly reader!: EntryReadUseCase;
  @Inject(TypeEditUseCase) private readonly edits!: TypeEditUseCase;

  @Get("/types")
  async list(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    if (!spec) return noSiteYet(ctx);

    html(
      ctx,
      200,
      page({
        title: "Content types",
        trail: [{ label: "Content types" }],
        section: "types",
        body: typeList({ spec, counts: await this.reader.counts(spec), error: error(ctx) }),
      }),
    );
  }

  @Post("/types")
  async create(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    if (!spec) return noSiteYet(ctx);

    const body = form(ctx);
    const key = str(body["key"]).trim();
    const result = await this.edits.create(
      spec,
      key,
      str(body["label"]),
      str(body["labelPlural"]),
      {
        actor: actor(ctx),
      },
    );

    redirect(
      ctx,
      result.ok ? `/admin/types/${encodeURIComponent(key)}` : withError("/admin/types", result),
    );
  }

  @Get("/types/:key")
  async show(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = keyOf(ctx);
    const type = spec?.content.find((t) => t.key === key);
    if (!spec || !type) return notFound(ctx);

    const query = ctx.query as Record<string, unknown>;
    const asked = query["field"];
    const selected = type.fields.find((f) => f.name === asked)?.name ?? null;
    const counts = await this.reader.counts(spec);

    html(
      ctx,
      200,
      page({
        title: `${type.label} — content type`,
        trail: [{ label: "Content types", href: "/admin/types" }, { label: type.label }],
        section: "types",
        body: typeBuilder({
          spec,
          type,
          entries: counts[type.key] ?? 0,
          selected,
          error: error(ctx),
          confirm: typeof query["confirm"] === "string" ? query["confirm"] : undefined,
        }),
      }),
    );
  }

  /** The "about this type" form. */
  @Post("/types/:key")
  async update(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = keyOf(ctx);
    if (!spec) return noSiteYet(ctx);

    const body = form(ctx);
    const submissions = str(body["submissions"]);
    const result = await this.edits.update(
      spec,
      key,
      {
        label: str(body["label"]),
        labelPlural: str(body["labelPlural"]),
        titleField: str(body["titleField"]) || undefined,
        permalink: str(body["permalink"]),
        publishable: flag(body["publishable"]),
        submissions:
          submissions === "visitors" || submissions === "anyone" ? submissions : undefined,
      },
      { actor: actor(ctx) },
    );

    this.back(ctx, key, result);
  }

  /** Add, move or remove a field — one form, the way the automation builder does it. */
  @Post("/types/:key/fields")
  async fields(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = keyOf(ctx);
    if (!spec) return noSiteYet(ctx);

    const body = form(ctx);
    const [op, argument] = str(body["op"]).split(":");
    const input = { actor: actor(ctx) };

    const result = await (async (): Promise<EditResult> => {
      switch (op) {
        case "add":
          return this.edits.addField(
            spec,
            key,
            str(body["name"]).trim(),
            str(body["label"]),
            str(body["type"]),
            input,
          );
        case "up":
          return this.edits.moveField(spec, key, Number(argument), -1, input);
        case "down":
          return this.edits.moveField(spec, key, Number(argument), 1, input);
        case "del":
          // Dropping a field drops its column. The first press is refused by
          // the gate, and the refusal names what would be lost — that message
          // is the confirmation, written by the layer that knows the count.
          return this.edits.removeField(spec, key, String(argument), {
            ...input,
            allowDestructive: str(body["confirm"]) === `field:${argument}`,
          });
        default:
          return { ok: false, error: "Nothing to do." };
      }
    })();

    // Straight to the new field when one was added, so the settings that follow
    // are the next thing on the screen rather than the next thing to find.
    if (result.ok && op === "add") {
      return redirect(
        ctx,
        `/admin/types/${encodeURIComponent(key)}?field=${encodeURIComponent(str(body["name"]).trim())}`,
      );
    }
    this.back(ctx, key, result, undefined, op === "del" ? `field:${argument}` : undefined);
  }

  /** One field's settings. */
  @Post("/types/:key/field")
  async field(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = keyOf(ctx);
    if (!spec) return noSiteYet(ctx);

    const body = form(ctx);
    const name = str(body["field"]);
    const result = await this.edits.updateField(
      spec,
      key,
      name,
      {
        label: str(body["label"]),
        help: str(body["help"]),
        required: flag(body["required"]),
        unique: flag(body["unique"]),
        filterable: flag(body["filterable"]),
        max: optionalNumber(body["max"]),
        min: optionalNumber(body["min"]),
        accept: str(body["accept"]) || undefined,
        options: str(body["options"]),
        to: str(body["to"]) || undefined,
        many: flag(body["many"]),
        values: str(body["values"]),
        initial: str(body["initial"]),
        transitions: str(body["transitions"]),
      },
      { actor: actor(ctx) },
    );

    this.back(ctx, key, result, name);
  }

  @Post("/types/:key/delete")
  async remove(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = keyOf(ctx);
    if (!spec) return noSiteYet(ctx);

    const result = await this.edits.remove(spec, key, {
      actor: actor(ctx),
      allowDestructive: str(form(ctx)["confirm"]) === "type",
    });

    if (result.ok) return redirect(ctx, "/admin/types");
    this.back(ctx, key, result, undefined, "type");
  }

  /**
   * Back where the press came from, carrying the refusal if there was one.
   *
   * `confirm` names what a second press would go ahead with. It travels in the
   * address rather than in a hidden field so the offer belongs to the refusal
   * that produced it: a stale tab cannot delete a field by being reloaded, and
   * nothing on the page is armed until the gate has said what would be lost.
   */
  private back(ctx: Ctx, key: string, result: EditResult, field?: string, confirm?: string): void {
    const at = `/admin/types/${encodeURIComponent(key)}`;
    const query = new URLSearchParams();
    if (field) query.set("field", field);
    if (!result.ok) {
      query.set("error", result.error);
      if (confirm) query.set("confirm", confirm);
    }
    const search = query.toString();
    redirect(ctx, search ? `${at}?${search}` : at);
  }
}

const keyOf = (ctx: Ctx): string => String((ctx.params as Record<string, string>)["key"] ?? "");
const actor = (ctx: Ctx): string => ctx.require("actor").email;
const form = (ctx: Ctx): Record<string, unknown> => (ctx.body ?? {}) as Record<string, unknown>;
const error = (ctx: Ctx): string | undefined => {
  const asked = (ctx.query as Record<string, unknown>)["error"];
  return typeof asked === "string" ? asked : undefined;
};

const withError = (at: string, result: EditResult): string =>
  result.ok ? at : `${at}?error=${encodeURIComponent(result.error)}`;

const str = (value: unknown): string =>
  typeof value === "string" ? value : Array.isArray(value) ? str(value[value.length - 1]) : "";

const optionalNumber = (value: unknown): number | undefined => {
  const raw = str(value).trim();
  return raw === "" ? undefined : Number(raw);
};

/**
 * A checkbox, read from the pair the form posts.
 *
 * An unchecked box sends nothing, so every checkbox is preceded by a hidden
 * `off`. The browser posts them in document order, which makes the **last**
 * value the answer: `off` alone when it is clear, `off,on` when it is ticked.
 */
const flag = (value: unknown): boolean => str(value) === "on";
