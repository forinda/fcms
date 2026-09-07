/**
 * Pay on arrival, by bank transfer, in cash.
 *
 * Takes no credentials, makes no network call, and is what most sites want on
 * the day they launch (ADR 0023 §5) — a salon taking a deposit at the chair, a
 * workshop invoicing by transfer. It is also what makes the rest of this
 * directory testable without a payment processor.
 *
 * There is no `confirm`, because there is nobody to ask. A person marks it paid
 * in the admin, which is exactly what happens in the shop.
 */
import type { ChargeRequest, ChargeResult, PaymentProvider } from "./provider";

export const manualProvider: PaymentProvider = {
  kind: "payment.manual",

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    const instruction = String(
      request.config["instruction"] ??
        "We will take payment directly. Someone will be in touch to arrange it.",
    );
    return { status: "pending", instruction };
  },
};
