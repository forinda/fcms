/**
 * Advancing a journey (ADR 0028).
 *
 * Two routes and no JavaScript: choosing posts the row that was picked, and
 * "Change" posts the step to forget. The page itself renders whichever step the
 * state says is next, so a refresh, a back button and a second tab all agree.
 */
import { Controller, Inject, Post, type Ctx } from "@forinda/kickjs";
import { runQuery, withDerived } from "@forinda-cms/render";
import type { Page } from "@forinda-cms/spec";

import { PublicSite } from "@/route-flags";
import { EntryReadUseCase, SiteSpecUseCase } from "@/shared/use-cases";
import { FLOW_COOKIE, FlowUseCase, type Flow } from "@/shared/flows/flow.usecase";
import { readCookie } from "@/contributors/actor.contributor";

@Controller()
@PublicSite
export class FlowController {
  @Inject(SiteSpecUseCase) private readonly specs!: SiteSpecUseCase;
  @Inject(EntryReadUseCase) private readonly entries!: EntryReadUseCase;
  @Inject(FlowUseCase) private readonly flows!: FlowUseCase;

  /**
   * A choice.
   *
   * The chosen row is looked up in what the step actually offers, never taken
   * from the request: a value naming a row the step never showed is a value
   * that must not enter the journey.
   */
  @Post("/flow/:page/:flow/:step")
  async choose(ctx: Ctx): Promise<void> {
    const found = await this.locate(ctx);
    if (!found) return this.back(ctx, "/");

    const { spec, page, flow, step } = found;

    // A step that asks rather than offers. Its answer is the parameters it
    // named, and they go back into the address as well as into the state: the
    // next step filters by `{ param: … }` like any other page, and a refresh
    // still shows the rooms for those dates.
    if (step?.captures?.length) {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const given: [string, string][] = step.captures.map((name) => [
        name,
        String(body[name] ?? "").slice(0, 200),
      ]);
      // Half-answered is not answered. A step recorded with an empty date is a
      // step the visitor cannot get back to and cannot pass.
      if (given.some(([, value]) => value === "")) return this.back(ctx, page.path);

      const token = this.token(ctx) ?? FlowUseCase.mint();
      await this.flows.choose(token, page, flow, step.key, Object.fromEntries(given));
      this.setCookie(ctx, token);
      return this.back(ctx, `${page.path}?${new URLSearchParams(given).toString()}`);
    }

    if (!step?.selects) return this.back(ctx, page.path);

    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const wanted = String(body["choice"] ?? "");

    // The rows this step offers, resolved exactly as the page resolved them —
    // `withDerived`, because a slot is computed and the raw source has none of
    // them. Without it a step that chooses a time offers nothing to match.
    const held = spec.content.flatMap((t) => (t.derived ? [t.derived.occupied.type] : []));
    const source = withDerived(
      spec,
      await this.entries.source(
        spec.content.map((t) => t.key),
        null,
        held,
      ),
    );
    const offered = step.blocks.flatMap((block) =>
      block.data ? [...runQuery(source, block.data, {})] : [],
    );
    const chosen = offered.find(
      (row) => String(row["slug"] ?? row["id"] ?? "") === wanted && wanted !== "",
    );
    if (!chosen) return this.back(ctx, page.path);

    const token = this.token(ctx) ?? FlowUseCase.mint();
    await this.flows.choose(token, page, flow, step.key, chosen as Record<string, unknown>);

    this.setCookie(ctx, token);
    this.back(ctx, page.path);
  }

  /** "Change" — forget a step, and everything that depended on it. */
  @Post("/flow/:page/:flow/:step/undo")
  async undo(ctx: Ctx): Promise<void> {
    const found = await this.locate(ctx);
    const token = this.token(ctx);
    if (!found || !token) return this.back(ctx, found?.page.path ?? "/");

    await this.flows.forget(token, found.page, found.flow, String(found.step?.key ?? ""));
    this.back(ctx, found.page.path);
  }

  /** The page, flow and step a request names, or nothing. */
  private async locate(ctx: Ctx): Promise<{
    spec: NonNullable<Awaited<ReturnType<SiteSpecUseCase["execute"]>>>;
    page: Page;
    flow: Flow;
    step: Flow["steps"][number] | undefined;
  } | null> {
    const spec = await this.specs.execute();
    const params = ctx.params as Record<string, string>;
    const page = spec?.pages.find((p) => p.key === params["page"]);
    const flow = page?.flows?.find((f) => f.key === params["flow"]);
    if (!spec || !page || !flow) return null;

    return { spec, page, flow, step: flow.steps.find((s) => s.key === params["step"]) };
  }

  private token(ctx: Ctx): string | undefined {
    const headers = ctx.req.headers as Record<string, string | string[] | undefined>;
    const raw = headers["cookie"];
    return readCookie(Array.isArray(raw) ? raw[0] : raw, FLOW_COOKIE);
  }

  private setCookie(ctx: Ctx, token: string): void {
    const secure = process.env["SECURE_COOKIES"] === "true" ? " Secure;" : "";
    ctx.res.setHeader(
      "set-cookie",
      `${FLOW_COOKIE}=${token}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=86400`,
    );
  }

  private back(ctx: Ctx, to: string): void {
    ctx.res.statusCode = 303;
    ctx.res.setHeader("location", to);
    ctx.res.end();
  }
}
