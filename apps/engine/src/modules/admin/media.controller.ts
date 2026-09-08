/**
 * The media library.
 *
 * ADR 0010 put media in Phase 1+ and the admin has said "media needs the asset
 * store" on its dashboard since Phase 0b. This is that store: upload, name,
 * delete, and copy the reference a page uses.
 */
import { Controller, Delete, FileUpload, Get, Inject, Post, type Ctx } from "@forinda/kickjs";

import { atLeast, refusal, roleOf } from "@/shared/roles";

import { MediaUseCase } from "./use-cases/media.usecase";
import { html, notFound, redirect } from "./utils/http";
import { media } from "./utils/media.view";
import { esc, page as shell } from "./utils/view";

@Controller()
export class MediaController {
  @Inject(MediaUseCase) private readonly assets!: MediaUseCase;

  @Get("/media")
  async index(ctx: Ctx): Promise<void> {
    const query = ctx.query as Record<string, unknown>;

    html(
      ctx,
      200,
      shell({
        title: "Media",
        trail: [{ label: "Media" }],
        body: media({
          assets: await this.assets.list(),
          ...(typeof query["error"] === "string" ? { error: query["error"] } : {}),
        }),
      }),
    );
  }

  /**
   * Upload one file.
   *
   * Buffered rather than streamed to disk: the content hash decides the path,
   * so the bytes have to be in hand before there is a name to write them under
   * — and the 10 MB cap keeps that honest.
   */
  @Post("/media")
  @FileUpload({ mode: "single", fieldName: "file" })
  async upload(ctx: Ctx): Promise<void> {
    const refused = mayWrite(ctx);
    if (refused)
      return html(
        ctx,
        403,
        shell({
          role: roleOf(ctx.require("actor").role),
          title: "Not allowed",
          body: `<h1>Not allowed</h1><p class="error" role="alert">${esc(refused)}</p>`,
        }),
      );

    const file = ctx.file as { buffer: Buffer; originalname: string; mimetype: string } | undefined;
    if (!file) return redirect(ctx, "/admin/media?error=Choose+a+file+first.");

    const result = await this.assets.upload(file);
    redirect(
      ctx,
      result.ok ? "/admin/media" : `/admin/media?error=${encodeURIComponent(result.error)}`,
    );
  }

  @Post("/media/:id/alt")
  async describe(ctx: Ctx): Promise<void> {
    const refused = mayWrite(ctx);
    if (refused)
      return html(
        ctx,
        403,
        shell({
          role: roleOf(ctx.require("actor").role),
          title: "Not allowed",
          body: `<h1>Not allowed</h1><p class="error" role="alert">${esc(refused)}</p>`,
        }),
      );

    const body = ctx.body as Record<string, unknown>;
    await this.assets.setAlt(
      String((ctx.params as Record<string, string>)["id"]),
      String(body["alt"] ?? ""),
    );
    redirect(ctx, "/admin/media");
  }

  @Post("/media/:id/delete")
  async remove(ctx: Ctx): Promise<void> {
    const refused = mayWrite(ctx);
    if (refused)
      return html(
        ctx,
        403,
        shell({
          role: roleOf(ctx.require("actor").role),
          title: "Not allowed",
          body: `<h1>Not allowed</h1><p class="error" role="alert">${esc(refused)}</p>`,
        }),
      );

    await this.assets.remove(String((ctx.params as Record<string, string>)["id"]));
    redirect(ctx, "/admin/media");
  }

  /** Kept for a JSON caller; the form posts to the route above. */
  @Delete("/media/:id")
  async destroy(ctx: Ctx): Promise<void> {
    const ok = await this.assets.remove(String((ctx.params as Record<string, string>)["id"]));
    if (!ok) return notFound(ctx);
    ctx.res.statusCode = 204;
    ctx.res.end();
  }
}

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
