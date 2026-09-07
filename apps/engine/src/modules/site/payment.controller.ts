/**
 * Paying, from the customer's side.
 *
 * A platform page rather than something an owner composes (ADR 0023 §7): a
 * payment screen has to say exactly what was charged and what state it is in,
 * and a page that could be laid out freely is a page that can end up saying
 * "paid" over a payment that failed.
 *
 * Rendered in the site's own theme so it does not read as somebody else's
 * checkout, and it refreshes itself while a payment is pending — no JavaScript,
 * like the rest of the site.
 */
import { Controller, Get, Inject, Post, type Ctx } from "@forinda/kickjs";
import { siteCss } from "@forinda-cms/render";
import type { PaymentRow } from "@forinda-cms/db";
import type { SiteSpec } from "@forinda-cms/spec";

import { PublicSite } from "@/route-flags";
import { PaymentRepository, PaymentUseCase, PROVIDERS } from "@/shared/payments";
import { SiteSpecUseCase } from "@/shared/use-cases";

@Controller()
@PublicSite
export class PaymentController {
  @Inject(SiteSpecUseCase) private readonly specs!: SiteSpecUseCase;
  @Inject(PaymentRepository) private readonly payments!: PaymentRepository;
  @Inject(PaymentUseCase) private readonly pay!: PaymentUseCase;

  /**
   * Where a payable submission lands.
   *
   * Confirms with the provider on every view rather than trusting the row: the
   * page a customer stares at is exactly where a stale `pending` is most
   * expensive, and the provider is the only source of truth (ADR 0023 §4).
   */
  @Get("/pay/:id")
  async show(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const found = spec ? await this.payments.byId(paymentId(ctx)) : null;
    if (!spec || !found) return notFound(ctx);

    const payment = await this.pay.confirm(spec, found);
    const integration = spec.wiring.find((i) => i.key === payment.via);
    const written = String(integration?.config?.["instruction"] ?? "");

    html(ctx, page(spec, payment, instructionFor(payment, written || "Payment is pending.")));
  }

  /**
   * Start a charge that needed something from the payer first — a phone number.
   *
   * Only ever for a payment that has not moved: re-posting this must not create
   * a second charge for the same booking.
   */
  @Post("/pay/:id")
  async start(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const payment = spec ? await this.payments.byId(paymentId(ctx)) : null;
    if (!spec || !payment) return notFound(ctx);

    if (payment.status !== "pending" || payment.reference) {
      return redirect(ctx, `/pay/${payment.id}`);
    }

    // Charges the row that already exists rather than making another: this
    // route only exists to collect what the provider needed from the payer.
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    await this.pay.charge(spec, payment, String(body["payer"] ?? ""));

    redirect(ctx, `/pay/${payment.id}`);
  }

  /**
   * A provider telling us something happened.
   *
   * The body is not believed — it is read for one thing, the provider's own
   * reference, and everything after that is a question put to the provider
   * (ADR 0023 §4). Forging this achieves nothing but a re-check, which is why
   * it needs no signature scheme to be safe.
   */
  @Post("/pay/callback/:provider")
  async callback(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const provider = String((ctx.params as Record<string, string>)["provider"] ?? "");
    const reference = referenceIn(ctx.body);

    if (spec && reference) {
      const payment = await this.payments.byReference(provider, reference);
      if (payment) await this.pay.confirm(spec, payment);
    }

    // Always 200, always the same body: a provider retrying forever because we
    // answered 404 is worse than a callback we ignored, and a different answer
    // for "found" and "not found" tells a prober which references exist.
    ctx.res.statusCode = 200;
    ctx.res.setHeader("content-type", "application/json; charset=utf-8");
    ctx.res.end(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }));
  }
}

/** M-Pesa nests it; another provider will put it somewhere else of its own. */
export function referenceIn(body: unknown): string | null {
  const root = (body ?? {}) as Record<string, unknown>;
  const callback = ((root["Body"] as Record<string, unknown>)?.["stkCallback"] ?? {}) as Record<
    string,
    unknown
  >;
  const id = callback["CheckoutRequestID"] ?? root["CheckoutRequestID"] ?? root["reference"];
  return typeof id === "string" && id.length > 0 ? id : null;
}

function paymentId(ctx: Ctx): string {
  return String((ctx.params as Record<string, string>)["id"] ?? "");
}

const WORDS: Record<string, string> = {
  pending: "Waiting for payment",
  paid: "Paid",
  failed: "Payment failed",
  expired: "Payment expired",
  refunded: "Refunded",
};

function instructionFor(payment: PaymentRow, fallback: string): string {
  if (payment.status === "paid") return "Thank you — that is settled.";
  if (payment.status === "failed") return "Nothing was charged. You can try again.";

  const provider = PROVIDERS[payment.provider];
  if (provider?.needsPayerRef && !payment.reference) {
    return "Enter the number to send the payment request to.";
  }
  // A provider with nobody to ask has already said everything it can — the
  // owner's own instruction, which is what a customer needs to act on.
  if (!provider?.confirm) return fallback;
  return "Waiting for confirmation. This page updates itself.";
}

/** Minor units as money, without a currency library for one line of arithmetic. */
export function money(amount: number, currency: string): string {
  return `${currency} ${(amount / 100).toFixed(2)}`;
}

function page(spec: SiteSpec, payment: PaymentRow, instruction: string): string {
  const provider = PROVIDERS[payment.provider];
  const asking = payment.status === "pending" && provider?.needsPayerRef && !payment.reference;
  // Only refresh where there is something to wait *for*: a provider that can be
  // asked, and a charge already sent to it. A manual payment refreshing every
  // five seconds would poll forever for an answer that only ever arrives when
  // somebody hands over cash.
  const waiting =
    payment.status === "pending" && !asking && !!provider?.confirm && !!payment.reference;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(WORDS[payment.status] ?? "Payment")} — ${esc(spec.name)}</title>
<meta name="robots" content="noindex">
${waiting ? '<meta http-equiv="refresh" content="5">' : ""}
<style>${siteCss(spec)}
.pay{max-width:26rem;margin:4rem auto;padding:0 1rem}
.pay .amount{font-size:2rem;font-weight:700;margin:.2rem 0}
.pay .state{display:inline-block;padding:.15rem .6rem;border-radius:99px;background:#f5f5f4}
.pay form{margin-top:1.2rem;display:flex;gap:.5rem}
.pay input{flex:1;padding:.5rem;border:1px solid #d6d3d1;border-radius:6px}
</style></head><body><main class="pay">
<p class="state">${esc(WORDS[payment.status] ?? payment.status)}</p>
<p class="amount">${esc(money(payment.amount, payment.currency))}</p>
<p>${esc(instruction)}</p>
${
  asking
    ? `<form method="post" action="/pay/${esc(payment.id)}">
  <input name="payer" inputmode="tel" placeholder="07XX XXX XXX" required>
  <button type="submit">Send request</button>
</form>`
    : ""
}
${provider?.unverified ? "<p><small>This payment method has not been verified against the live provider yet.</small></p>" : ""}
</main></body></html>`;
}

function esc(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function html(ctx: Ctx, body: string): void {
  ctx.res.statusCode = 200;
  ctx.res.setHeader("content-type", "text/html; charset=utf-8");
  ctx.res.end(body);
}

function redirect(ctx: Ctx, to: string): void {
  ctx.res.statusCode = 303;
  ctx.res.setHeader("location", to);
  ctx.res.end();
}

function notFound(ctx: Ctx): void {
  ctx.res.statusCode = 404;
  ctx.res.setHeader("content-type", "text/html; charset=utf-8");
  ctx.res.end("<!doctype html><meta charset=utf-8><title>Not found</title><h1>Not found</h1>");
}
