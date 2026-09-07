/**
 * What a visitor may write (ADR 0020 §3).
 *
 * One route, and the narrowest one in the product: it can create a row of a
 * content type the **spec** marks `submissions`, and nothing else. No patch, no
 * page, no field, no upload. That is why visitors need no roles — the
 * permission is one declaration per type, visible in the diff when it changes.
 *
 * Everything it writes arrives unpublished (#30), which is moderation without a
 * moderation system: a review site cannot be defaced by a script that found the
 * form, because nothing it submits is visible until somebody publishes it.
 */
import { Controller, Inject, Post, type Ctx } from "@forinda/kickjs";
import { coerceEntryInput, type SiteSpec } from "@forinda-cms/spec";

import { PublicSite } from "@/route-flags";
import { EntryWriteUseCase } from "@/modules/admin/use-cases/entries.usecase";
import { SiteSpecUseCase } from "@/shared/use-cases";
import { VisitorUseCase } from "@/shared/visitors/visitor.usecase";
import { SubmissionLimitUseCase } from "@/shared/visitors/submission-limit.usecase";
import { PaymentUseCase } from "@/shared/payments";
import { FLOW_COOKIE, FlowUseCase } from "@/shared/flows/flow.usecase";
import { WorkflowUseCase } from "@/shared/workflows/workflow.usecase";
import { readCookie } from "@/contributors/actor.contributor";
import { VISITOR_COOKIE } from "./account.controller";

@Controller()
@PublicSite
export class SubmissionController {
  @Inject(SiteSpecUseCase) private readonly specs!: SiteSpecUseCase;
  @Inject(EntryWriteUseCase) private readonly entries!: EntryWriteUseCase;
  @Inject(VisitorUseCase) private readonly visitors!: VisitorUseCase;
  @Inject(SubmissionLimitUseCase) private readonly limit!: SubmissionLimitUseCase;
  @Inject(PaymentUseCase) private readonly pay!: PaymentUseCase;
  @Inject(FlowUseCase) private readonly flows!: FlowUseCase;
  @Inject(WorkflowUseCase) private readonly workflows!: WorkflowUseCase;

  @Post("/submit/:type")
  async submit(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = String((ctx.params as Record<string, string>)["type"] ?? "");
    const type = spec?.content.find((t) => t.key === key);
    const body = (ctx.body ?? {}) as Record<string, unknown>;

    // Absent means nobody. A type is a public write target only by saying so.
    if (!spec || !type || !type.submissions || type.derived) {
      return this.back(ctx, body, "That form is not accepting anything.");
    }

    const visitor = await this.visitors.fromToken(this.token(ctx));
    if (type.submissions === "visitors" && !visitor) {
      return this.back(ctx, body, "Sign in first.");
    }

    // An unauthenticated write endpoint on a public site is a spam target the
    // day it exists, so this is limited whether or not somebody is signed in.
    const ip = clientAddress(ctx);
    if (!(await this.limit.allow(key, visitor?.id ?? null, ip))) {
      return this.back(ctx, body, "Too many submissions. Try again in a few minutes.");
    }

    // Only declared fields, and only from this request: `coerceEntryInput` is
    // strict, so an extra key is rejected rather than stored.
    const { from: _from, ...fields } = body;

    // A flow's selections are merged from its state row, never from the form
    // (ADR 0028 §4): a hidden input carrying the chosen stylist is a hidden
    // input a caller can change. They win over anything posted with the same
    // name, for the same reason.
    const journey = await this.journey(ctx, spec, key);
    const data = coerceEntryInput(type, { ...fields, ...journey.selections });

    const result = await this.entries.create(spec, {
      typeKey: key,
      data,
      // So the person who booked can see what they booked (ADR 0027). Null for
      // an anonymous submission, which stays anonymous.
      visitorId: visitor?.id ?? null,
      // Draft, always. Nothing a stranger writes is visible until someone
      // publishes it.
      status: "draft",
    });

    if (!result.ok) {
      const first = Object.values(result.errors)[0] ?? "That could not be saved.";
      return this.back(ctx, body, first);
    }

    await this.limit.record(key, visitor?.id ?? null, ip);

    // The journey is over: its state goes, and whatever `onComplete` names runs
    // against the entry it just produced — through the same runner every other
    // automation uses (ADR 0024), so it retries and is visible.
    if (journey.flow) {
      await this.flows.finish(this.flowToken(ctx), journey.page.key, journey.flow.key);
      await this.workflows.enqueueSteps(spec, journey.flow.onComplete ?? [], {
        typeKey: key,
        entryId: result.entry.id,
        label: `${journey.page.key}/${journey.flow.key}`,
      });
    }

    // A payable type sends the person to pay for what they just booked
    // (ADR 0023). The entry is written either way and stays a draft — paying
    // does not publish anything, and an owner still decides what appears.
    if (type.payment) {
      const payment = await this.pay.record({
        spec,
        type,
        entryId: result.entry.id,
        data,
      });
      if (payment.ok) return this.redirectTo(ctx, `/pay/${payment.payment.id}`);
      return this.back(ctx, body, payment.error);
    }

    this.back(ctx, body, undefined, "Thank you — it will appear once it is approved.");
  }

  /**
   * The flow this submission completes, if it completes one.
   *
   * Found by looking for a flow whose last step writes this type — the author
   * declared the journey, so nothing here needs a second declaration saying
   * which form belongs to it.
   */
  private async journey(ctx: Ctx, spec: SiteSpec, typeKey: string) {
    const token = this.flowToken(ctx);
    for (const page of spec.pages) {
      for (const flow of page.flows ?? []) {
        const writes = flow.steps.some((step) =>
          step.blocks.some((b) => b.type === "form" && b.attrs?.["for"] === typeKey),
        );
        if (!writes) continue;

        const answers = await this.flows.answers(token, page.key, flow.key);
        if (Object.keys(answers).length === 0) continue;

        return {
          page,
          flow,
          selections: FlowUseCase.fieldsFrom(spec, flow, typeKey, answers),
        };
      }
    }
    return { page: undefined, flow: undefined, selections: {} as Record<string, unknown> };
  }

  private redirectTo(ctx: Ctx, to: string): void {
    ctx.res.statusCode = 303;
    ctx.res.setHeader("location", to);
    ctx.res.end();
  }

  /** The journey token — the same cookie the flow routes set. */
  private flowToken(ctx: Ctx): string | undefined {
    const headers = ctx.req.headers as Record<string, string | string[] | undefined>;
    const raw = headers["cookie"];
    return readCookie(Array.isArray(raw) ? raw[0] : raw, FLOW_COOKIE);
  }

  private token(ctx: Ctx): string | undefined {
    const headers = ctx.req.headers as Record<string, string | string[] | undefined>;
    const raw = headers["cookie"];
    return readCookie(Array.isArray(raw) ? raw[0] : raw, VISITOR_COOKIE);
  }

  /** Same-site paths only — see the note on the account controller's redirect. */
  private back(ctx: Ctx, body: Record<string, unknown>, error?: string, done?: string): void {
    const asked = String(body["from"] ?? "/");
    const to = /^\/(?!\/)[^\s]*$/.test(asked) ? asked : "/";
    const sep = to.includes("?") ? "&" : "?";
    const query = error
      ? `${sep}form_error=${encodeURIComponent(error)}`
      : done
        ? `${sep}form_done=${encodeURIComponent(done)}`
        : "";

    ctx.res.statusCode = 303;
    ctx.res.setHeader("location", `${to}${query}`);
    ctx.res.end();
  }
}

function clientAddress(ctx: Ctx): string | null {
  const req = ctx.req as { ip?: string; socket?: { remoteAddress?: string } };
  return req.ip ?? req.socket?.remoteAddress ?? null;
}
