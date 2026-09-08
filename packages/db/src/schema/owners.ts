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
    /**
     * What this person may do (ADR 0008 §2, ADR 0041).
     *
     * `owner` is the account the install created and the only one that can add
     * or remove people. The rest are ADR 0008's site roles, stored as text
     * rather than a Postgres enum so adding one is a deploy rather than a
     * migration with a lock on it.
     *
     * Defaulted to `owner` so the account that existed before this column did
     * keeps everything it had — a migration that quietly demotes the only
     * person who can sign in is a migration that locks somebody out of their
     * own site.
     */
    role: text().notNull().default("owner"),
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
    /**
     * When this session was last used.
     *
     * The column that makes a sessions screen worth having: "signed in from
     * somewhere on 3 March" is not enough to decide whether a session is yours,
     * and "last used two minutes ago" is.
     */
    lastUsedAt: timestamp({ withTimezone: true }),
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

/**
 * Failed sign-in attempts.
 *
 * Rate limiting needs to survive a restart and be shared across every process
 * that answers `/admin/login` — an in-memory counter is neither, and on a
 * two-container install it is a lock that protects one of them.
 *
 * Keyed by what was tried and from where. Both matter: locking only by email
 * lets one attacker lock a real owner out of their own site, and locking only
 * by address does nothing to a distributed attempt.
 */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: pk(),
    /**
     * What was being attempted.
     *
     * `login` and `submit` share this table because both answer "how often has
     * this address done this lately" — but they must not share a *counter*:
     * without this column, filling a public contact form twenty times
     * rate-limited the owner's own sign-in from the same address, turning spam
     * into a denial of service against the one person who could clear it.
     */
    kind: text().notNull().default("login"),
    /** Lowercased email as submitted — not a foreign key, since it may be nobody. */
    email: text().notNull(),
    ipAddress: text(),
    at: createdAt(),
  },
  (t) => [
    index("login_attempts_kind_email_at").on(t.kind, t.email, t.at),
    index("login_attempts_at").on(t.at),
  ],
);

export type LoginAttemptRow = typeof loginAttempts.$inferSelect;
