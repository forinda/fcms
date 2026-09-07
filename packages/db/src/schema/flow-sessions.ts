/**
 * Where a visitor is in a journey, and what they have chosen (ADR 0028).
 *
 * The state is a row and the visitor holds an opaque token, rather than a
 * signed cookie carrying the answers: a booking journey accumulates choices, so
 * the payload grows on every request, it is readable by anyone with the device,
 * and the moment a flow carries a price it is a number a client can be tempted
 * to edit. What the customer sends is a request, not a fact.
 */
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { createdAt, pk } from "./_shared.js";
import { sites } from "./sites.js";

export const flowSessions = pgTable(
  "flow_sessions",
  {
    id: pk(),
    siteId: text()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    orgId: text().notNull(),

    /** The page and flow this belongs to — one journey per flow per token. */
    pageKey: text().notNull(),
    flowKey: text().notNull(),

    /** Hashed, like every other token this project stores. */
    tokenHash: text().notNull(),

    /**
     * Step key → what was chosen there.
     *
     * A whole row rather than an id: the journey shows what you picked, and a
     * template reads `{{ flow.stylist.name }}` without a second lookup.
     */
    answers: jsonb().$type<Record<string, Record<string, unknown>>>().notNull().default({}),

    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** 24 hours. Nobody returns to an abandoned booking journey a week later. */
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("flow_sessions_token").on(t.tokenHash, t.pageKey, t.flowKey),
    index("flow_sessions_expiry").on(t.expiresAt),
  ],
);

export type FlowSessionRow = typeof flowSessions.$inferSelect;
export type NewFlowSessionRow = typeof flowSessions.$inferInsert;
