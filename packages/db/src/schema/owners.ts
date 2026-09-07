/**
 * The people who can sign in, and their sessions.
 *
 * Phase 0b is one owner per install (ADR 0008 as amended, after the Better Auth
 * spike). The table is shaped for more than one because adding a column later is
 * cheap and adding a table later means migrating sessions — but nothing yet
 * creates a second row.
 */
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { createdAt, fk, pk } from "./_shared.js";
import { organizations } from "./organizations.js";

export const owners = pgTable(
  "owners",
  {
    id: pk(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text().notNull(),
    /** argon2id. Never a password, never a reversible encoding of one. */
    passwordHash: text().notNull(),
    name: text(),
    createdAt: createdAt(),
    lastSeenAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex("owners_email").on(t.email)],
);

/**
 * Sessions.
 *
 * Stores a **hash** of the token, not the token. A database read, a backup, or a
 * leaked dump must not hand out live sessions, and hashing is the difference
 * between an exposure and a breach.
 */
export const ownerSessions = pgTable(
  "owner_sessions",
  {
    id: pk(),
    ownerId: fk()
      .notNull()
      .references(() => owners.id, { onDelete: "cascade" }),
    tokenHash: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
    userAgent: text(),
    ipAddress: text(),
  },
  (t) => [
    uniqueIndex("owner_sessions_token").on(t.tokenHash),
    index("owner_sessions_owner").on(t.ownerId),
  ],
);

export type OwnerRow = typeof owners.$inferSelect;
export type NewOwnerRow = typeof owners.$inferInsert;
export type OwnerSessionRow = typeof ownerSessions.$inferSelect;
export type NewOwnerSessionRow = typeof ownerSessions.$inferInsert;
