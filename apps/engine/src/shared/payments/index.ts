/**
 * The provider registry.
 *
 * Keyed by the `wiring` kind, so adding a provider is a file and a line — the
 * same shape blocks and plugins use, and for the same reason: anything that
 * enumerates providers (the admin, the validator) reads this rather than a list
 * somebody has to remember to update.
 */
import { manualProvider } from "./manual.provider";
import { mpesaProvider } from "./mpesa.provider";
import type { PaymentProvider } from "./provider";

export const PROVIDERS: Record<string, PaymentProvider> = {
  [manualProvider.kind]: manualProvider,
  [mpesaProvider.kind]: mpesaProvider,
};

export * from "./provider";
export * from "./payment.repository";
export * from "./payment.usecase";
