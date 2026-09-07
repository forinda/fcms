/**
 * The people who *use* a site, as opposed to the people who run it.
 *
 * A separate table from `owners` on purpose (ADR 0020): a visitor belongs to one
 * site rather than an organisation, signs themselves up, holds no role, and can
 * never write the spec. One table with a weak role would make a permissions bug
 * the difference between "saved a hotel" and "edited the site".
 */
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { createdAt, fk, pk } from "./_shared.js";
import { sites } from "./sites.js";

export const visitors = pgTable(
  "visitors",
  {
    id: pk(),
    siteId: text()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    email: text().notNull(),
    /** argon2id — the same hashing the owners use, because two hashers is one that rots. */
    passwordHash: text().notNull(),
    name: text(),
    createdAt: createdAt(),
    lastSeenAt: timestamp({ withTimezone: true }),
  },
  // Unique per site, not globally: an account on two sites of one agency's
  // clients is two accounts, because they are two businesses.
  (t) => [uniqueIndex("visitors_site_email").on(t.siteId, t.email)],
);

export const visitorSessions = pgTable(
  "visitor_sessions",
  {
    id: pk(),
    visitorId: fk()
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    /** Hashed, like every other session token this project stores. */
    tokenHash: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
    ipAddress: text(),
  },
  (t) => [
    uniqueIndex("visitor_sessions_token").on(t.tokenHash),
    index("visitor_sessions_visitor").on(t.visitorId),
  ],
);

/**
 * What a visitor kept.
 *
 * A join table rather than content (ADR 0020 §5): saves have no fields, never
 * render as a page, and a hundred thousand of them should not sit in the table
 * the site reads to draw itself.
 */
export const visitorSaves = pgTable(
  "visitor_saves",
  {
    id: pk(),
    visitorId: fk()
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    typeKey: text().notNull(),
    entryId: fk().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("visitor_saves_unique").on(t.visitorId, t.entryId),
    index("visitor_saves_visitor").on(t.visitorId),
  ],
);

export type VisitorRow = typeof visitors.$inferSelect;
export type VisitorSessionRow = typeof visitorSessions.$inferSelect;
export type VisitorSaveRow = typeof visitorSaves.$inferSelect;
