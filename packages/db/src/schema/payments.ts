/**
 * Money taken from a site's customer, on behalf of the site's owner.
 *
 * Not the platform's own billing (ADR 0011) — this is a salon's deposit and a
 * hotel's booking. It points at an `entry` because the entry *is* the order
 * (ADR 0023 §1): the content type an owner already designed describes what was
 * bought, so a second representation would only mean two places to look.
 *
 * Everything here is written by the platform. Nothing in a spec can set a
 * status, an amount or a reference, and no request from the public internet can
 * either.
 */
import { bigint, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { createdAt, fk, pk } from "./_shared.js";
import { entries } from "./entries.js";
import { sites } from "./sites.js";

export const payments = pgTable(
  "payments",
  {
    id: pk(),
    siteId: text()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    orgId: text().notNull(),
    /** What is being paid for. Cascades: a deleted booking has no payment to show. */
    entryId: fk()
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    typeKey: text().notNull(),

    /** The integration key from the spec's `wiring`, and its kind at the time. */
    via: text().notNull(),
    provider: text().notNull(),

    /**
     * Minor units, integer, always.
     *
     * `bigint` because a currency with no minor unit and a large ticket — an
     * IDR hotel booking is eight digits before the cents — reaches the top of a
     * 32-bit integer, and money that overflows is not a bug anyone forgives.
     */
    amount: bigint({ mode: "number" }).notNull(),
    currency: text().notNull(),

    /** pending | paid | failed | expired | refunded (ADR 0023 §4). */
    status: text().notNull().default("pending"),

    /** The provider's own id for this charge. Null until it has one. */
    reference: text(),
    /** How to reach the payer for this charge — a phone number for M-Pesa. */
    payerRef: text(),

    /**
     * What the provider said, for support and disputes.
     *
     * Never a credential: providers echo request fields back, so what goes in
     * here is filtered rather than dumped.
     */
    detail: jsonb().$type<Record<string, unknown>>(),

    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    // Confirming twice is a no-op, which is what makes a retried callback safe
    // — and every provider that exists retries.
    uniqueIndex("payments_site_provider_reference").on(t.siteId, t.provider, t.reference),
    index("payments_site_status").on(t.siteId, t.status),
    index("payments_entry").on(t.entryId),
  ],
);

export type PaymentRow = typeof payments.$inferSelect;
export type NewPaymentRow = typeof payments.$inferInsert;
