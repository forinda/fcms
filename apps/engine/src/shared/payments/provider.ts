/**
 * What a payment provider has to be able to do.
 *
 * Two methods, because two is what the flow needs: start a charge, and answer
 * authoritatively whether it happened. Everything else — the row, the state
 * machine, what a callback is allowed to change — belongs to the use-case, so a
 * new provider is a file rather than a feature (ADR 0023 §5).
 *
 * `confirm` is the reason a callback can be trusted with nothing: the platform
 * asks the provider rather than believing what was posted to it.
 */
export type PaymentStatus = "pending" | "paid" | "failed" | "expired" | "refunded";

export interface ChargeRequest {
  /** Minor units, integer. Computed from the entry, never from a request. */
  readonly amount: number;
  readonly currency: string;
  /** Where to reach the payer: a phone number for M-Pesa, absent for manual. */
  readonly payerRef?: string | undefined;
  /** Shown to the payer by the provider, where the provider shows anything. */
  readonly description: string;
  /** Non-secret settings from the integration's `config`. */
  readonly config: Readonly<Record<string, string | number | boolean>>;
  /** Resolved `secret:` references — values, and never logged or stored. */
  readonly secrets: Readonly<Record<string, string>>;
  /** Absolute URL the provider should call back. */
  readonly callbackUrl: string;
}

export interface ChargeResult {
  readonly status: PaymentStatus;
  /** The provider's id for this charge, where it issues one immediately. */
  readonly reference?: string | undefined;
  /** One line for the payer: "Check your phone", "Pay on arrival". */
  readonly instruction: string;
  /** Kept on the row for support. Filtered — providers echo request fields back. */
  readonly detail?: Record<string, unknown> | undefined;
}

export interface PaymentProvider {
  /** The `wiring` kind this implements. */
  readonly kind: string;
  /** True when this has never been run against the provider's real API (ADR 0023 §6). */
  readonly unverified?: boolean;
  /** Does the payer need to be asked for a phone number before starting? */
  readonly needsPayerRef?: boolean;
  charge(request: ChargeRequest): Promise<ChargeResult>;
  /**
   * Ask the provider what actually happened.
   *
   * Absent where there is nobody to ask — `manual` is confirmed by the owner in
   * the admin, which is the honest answer for cash.
   */
  confirm?(
    reference: string,
    request: Omit<ChargeRequest, "payerRef" | "callbackUrl">,
  ): Promise<{ status: PaymentStatus; detail?: Record<string, unknown> }>;
}
