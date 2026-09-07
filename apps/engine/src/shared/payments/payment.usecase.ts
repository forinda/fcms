/**
 * The rules about money, in one file.
 *
 * Everything a provider must not decide lives here (ADR 0023): what the amount
 * is, what a callback is allowed to change, and which transitions exist. A
 * provider says "the customer paid"; this decides what that means to the row.
 */
import { Inject, Scope as Lifetime, Service, getEnv } from "@forinda/kickjs";
import type { ContentType, Integration, SiteSpec } from "@forinda-cms/spec";
import type { PaymentRow } from "@forinda-cms/db";

import { EntryRepository } from "@/shared/repositories";
import { WorkflowUseCase } from "@/shared/workflows/workflow.usecase";
import { PaymentRepository } from "./payment.repository";
import { PROVIDERS } from "./index";
import type { ChargeRequest, PaymentProvider, PaymentStatus } from "./provider";

export interface StartInput {
  readonly spec: SiteSpec;
  readonly type: ContentType;
  readonly entryId: string;
  /** The row as written, for reading the price out of. */
  readonly data: Readonly<Record<string, unknown>>;
  readonly payerRef?: string | undefined;
}

export type StartResult =
  | { ok: true; payment: PaymentRow; instruction: string }
  | { ok: false; error: string };

/**
 * `paid` is terminal for the money.
 *
 * A late `failed` callback for a payment already confirmed is a retry arriving
 * out of order, not a reversal — refunds are a different operation with a
 * different record (ADR 0023, consequences).
 */
const TERMINAL = new Set<PaymentStatus>(["paid", "refunded"]);

@Service({ scope: Lifetime.REQUEST })
export class PaymentUseCase {
  constructor(
    @Inject(PaymentRepository) private readonly payments: PaymentRepository,
    @Inject(WorkflowUseCase) private readonly workflows: WorkflowUseCase,
    @Inject(EntryRepository) private readonly entries: EntryRepository,
  ) {}

  /**
   * Money arriving is an event automations can watch (ADR 0024).
   *
   * Fired only from a confirmed payment — the platform's own answer, never a
   * callback body (ADR 0023 §4), so "confirm the booking once the deposit is
   * paid" cannot be triggered by a stranger posting JSON.
   */
  private async announce(spec: SiteSpec, payment: PaymentRow): Promise<void> {
    await this.workflows.enqueue(spec, {
      on: "payment.succeeded",
      typeKey: payment.typeKey,
      entryId: payment.entryId,
    });
  }

  /**
   * The amount, in minor units, from the entry that was just written.
   *
   * Never from the request. A form that posts an amount lets someone pay 1 for
   * a 15,000 booking, and that is the default shape of a naive integration.
   */
  static amountOf(
    type: ContentType,
    data: Readonly<Record<string, unknown>>,
    /**
     * Rows of the type a dotted price reads through.
     *
     * A salon's deposit belongs to the service, not to the booking — and a
     * booking that copied it would be a number a form could carry, which is
     * the hole §3 exists to close.
     */
    referenced: Readonly<Record<string, unknown>> = {},
  ): number | null {
    const payment = type.payment;
    if (!payment) return null;
    if ("fixed" in payment.amount) return payment.amount.fixed;

    const path = payment.amount.field.split(".");
    const value = path.length === 2 ? referenced[path[1]!] : data[payment.amount.field];
    const major = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(major) || major <= 0) return null;

    // One conversion, rounded once, stored as an integer. Money kept as a float
    // is a rounding bug with a schedule attached.
    return Math.round(major * 100);
  }

  /**
   * Record what is owed, without charging anything yet.
   *
   * Split from `charge` because some providers need something from the payer
   * first — M-Pesa needs the phone number to push to — and the row has to exist
   * before there is a page to ask on. It also means asking twice cannot create
   * two charges for one booking: the second attempt charges the same row.
   */
  async record(input: StartInput): Promise<StartResult> {
    const { type, spec } = input;
    if (!type.payment) return { ok: false, error: "Nothing to pay for." };

    const integration = spec.wiring.find((i) => i.key === type.payment!.via);
    const provider = integration ? PROVIDERS[integration.kind] : undefined;
    if (!integration || !provider) {
      return { ok: false, error: "Payments are not set up for this site." };
    }

    const amount = PaymentUseCase.amountOf(
      type,
      input.data,
      await this.referenced(type, input.data),
    );
    if (amount === null) {
      // The price is missing or nonsense: better a refusal than a charge for an
      // amount nobody meant.
      return { ok: false, error: "That has no price on it, so it cannot be paid for." };
    }

    const payment = await this.payments.create({
      entryId: input.entryId,
      typeKey: type.key,
      via: integration.key,
      provider: integration.kind,
      amount,
      currency: type.payment.currency,
      status: "pending",
      payerRef: input.payerRef ?? null,
    });

    // A provider that needs the payer's number cannot be asked yet; the pay
    // page collects it and charges this same row.
    if (provider.needsPayerRef && !input.payerRef) {
      return { ok: true, payment, instruction: "One more detail is needed to take payment." };
    }

    return this.charge(spec, payment, input.payerRef);
  }

  /**
   * Ask the provider for the money, once, against a row that already exists.
   *
   * Refuses anything that has already been charged or settled: re-posting the
   * pay form must never produce a second charge for one booking.
   */
  async charge(spec: SiteSpec, payment: PaymentRow, payerRef?: string): Promise<StartResult> {
    if (payment.status !== "pending" || payment.reference) {
      return { ok: true, payment, instruction: "" };
    }

    const integration = spec.wiring.find((i) => i.key === payment.via);
    const provider = integration ? PROVIDERS[integration.kind] : undefined;
    const type = spec.content.find((t) => t.key === payment.typeKey);
    if (!integration || !provider || !type) {
      return { ok: false, error: "Payments are not set up for this site." };
    }
    if (provider.needsPayerRef && !payerRef) {
      return { ok: false, error: "A phone number is needed to send the payment request." };
    }

    const result = await provider.charge({
      ...this.request(integration, type, payment.amount),
      payerRef,
      callbackUrl: `${base()}/pay/callback/${encodeURIComponent(integration.kind)}`,
    });

    const updated = await this.payments.update(payment.id, {
      status: result.status,
      reference: result.reference ?? null,
      detail: result.detail ?? null,
      ...(payerRef ? { payerRef } : {}),
      ...(result.status === "paid" ? { paidAt: new Date() } : {}),
    });

    const settled = updated ?? payment;
    // A provider that settles immediately still announces itself.
    if (settled.status === "paid") await this.announce(spec, settled);

    return { ok: true, payment: settled, instruction: result.instruction };
  }

  /**
   * The row a dotted price reads through, when the type names one.
   *
   * Loaded here rather than passed in, so every caller of `record` gets the
   * same answer without knowing the price is somewhere else.
   */
  private async referenced(
    type: ContentType,
    data: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const amount = type.payment?.amount;
    if (!amount || !("field" in amount) || !amount.field.includes(".")) return {};

    const [first] = amount.field.split(".") as [string, string];
    const ref = String(data[first] ?? "");
    const slug = ref.startsWith("ref:") ? ref.split("/")[1] : ref;
    if (!slug) return {};

    const row = await this.entries.bySlug(slug);
    return (row?.data as Record<string, unknown>) ?? {};
  }

  /**
   * Ask the provider what actually happened, and record only that.
   *
   * Called from the status page and from a callback. The callback carries no
   * authority — it names a payment, and this decides (ADR 0023 §4), which is
   * why forging one achieves nothing but a re-check.
   */
  async confirm(spec: SiteSpec, payment: PaymentRow): Promise<PaymentRow> {
    if (TERMINAL.has(payment.status as PaymentStatus)) return payment;

    const integration = spec.wiring.find((i) => i.key === payment.via);
    const provider = integration ? PROVIDERS[integration.kind] : undefined;
    const type = spec.content.find((t) => t.key === payment.typeKey);
    if (!integration || !provider?.confirm || !type || !payment.reference) return payment;

    try {
      const answer = await provider.confirm(payment.reference, {
        ...this.request(integration, type, payment.amount),
      });
      if (answer.status === payment.status) return payment;

      const updated =
        (await this.payments.update(payment.id, {
          status: answer.status,
          detail: answer.detail ?? payment.detail,
          ...(answer.status === "paid" ? { paidAt: new Date() } : {}),
        })) ?? payment;

      if (updated.status === "paid") await this.announce(spec, updated);
      return updated;
    } catch {
      // A provider that will not answer leaves the payment where it was: an
      // unreachable API is not evidence that a customer did not pay.
      return payment;
    }
  }

  /** An owner saying the cash arrived — the only way a `manual` payment settles. */
  async settleManually(payment: PaymentRow, actor: string, spec?: SiteSpec): Promise<PaymentRow> {
    if (TERMINAL.has(payment.status as PaymentStatus)) return payment;

    const updated =
      (await this.payments.update(payment.id, {
        status: "paid",
        paidAt: new Date(),
        detail: { ...payment.detail, confirmedBy: actor },
      })) ?? payment;

    // Cash in a shop is still money arriving, and an owner automating "confirm
    // the booking once it is paid" means it whichever way it was paid.
    if (spec && updated.status === "paid") await this.announce(spec, updated);
    return updated;
  }

  /**
   * Config and resolved secrets for one integration.
   *
   * `secret:NAME` is looked up in the environment here and nowhere else, so a
   * value never reaches a spec, a patch, a log or a model (ADR 0001).
   */
  private request(
    integration: Integration,
    type: ContentType,
    amount: number,
  ): Omit<ChargeRequest, "payerRef" | "callbackUrl"> {
    const secrets: Record<string, string> = {};
    for (const [name, ref] of Object.entries(integration.secrets ?? {})) {
      const value = process.env[ref.replace(/^secret:/, "")];
      if (value) secrets[name] = value;
    }

    return {
      amount,
      currency: type.payment?.currency ?? "KES",
      description: type.payment?.label ?? type.label,
      config: integration.config ?? {},
      secrets,
    };
  }
}

/**
 * Where this site answers, for a callback URL the provider can reach.
 *
 * `PUBLIC_URL` is the same variable canonicals and the sitemap use — a provider
 * calling back needs exactly what a crawler needs, and a second variable would
 * be a second thing to get wrong.
 */
function base(): string {
  const configured = getEnv("PUBLIC_URL");
  return typeof configured === "string" && configured ? configured.replace(/\/$/, "") : "";
}

export type { PaymentProvider };
