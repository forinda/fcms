/**
 * Owners and their sessions. Rows in, rows out.
 */
import { and, asc, desc, eq, gt, lt, ne, or, sql } from "drizzle-orm";

import {
  loginAttempts,
  ownerSessions,
  owners,
  type OwnerRow,
  type OwnerSessionRow,
} from "@forinda-cms/db";
import type { Db } from "@forinda-cms/db";
import { hashToken, newSessionToken } from "@/shared/auth/tokens";

/** An id out of a URL must not reach a uuid column raw. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class OwnerRepository {
  constructor(private readonly db: Db) {}

  async findByEmail(email: string): Promise<OwnerRow | null> {
    const [row] = await this.db
      .select()
      .from(owners)
      .where(eq(owners.email, email.toLowerCase()))
      .limit(1);
    return row ?? null;
  }

  async count(): Promise<number> {
    const rows = await this.db.select({ id: owners.id }).from(owners).limit(1);
    return rows.length;
  }

  async create(values: {
    orgId: string;
    email: string;
    passwordHash: string;
    name?: string;
    role?: string;
  }): Promise<OwnerRow> {
    const [row] = await this.db
      .insert(owners)
      .values({
        orgId: values.orgId,
        email: values.email.toLowerCase(),
        passwordHash: values.passwordHash,
        name: values.name ?? null,
        ...(values.role ? { role: values.role } : {}),
      })
      .returning();
    return row!;
  }

  /** Everyone who can sign in, oldest first — the order they were added. */
  async list(orgId: string): Promise<OwnerRow[]> {
    return this.db
      .select()
      .from(owners)
      .where(eq(owners.orgId, orgId))
      .orderBy(asc(owners.createdAt));
  }

  async findById(id: string): Promise<OwnerRow | null> {
    if (!UUID.test(id)) return null;
    const [row] = await this.db.select().from(owners).where(eq(owners.id, id)).limit(1);
    return row ?? null;
  }

  async setRole(id: string, role: string): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const rows = await this.db
      .update(owners)
      .set({ role })
      .where(eq(owners.id, id))
      .returning({ id: owners.id });
    return rows.length > 0;
  }

  /**
   * Remove somebody.
   *
   * Their sessions go with them by the foreign key's cascade — an account that
   * is gone but whose browser still works is not gone.
   */
  async remove(id: string): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const rows = await this.db.delete(owners).where(eq(owners.id, id)).returning({ id: owners.id });
    return rows.length > 0;
  }

  /** How many accounts hold this role — asked before removing the last owner. */
  async countWithRole(orgId: string, role: string): Promise<number> {
    const rows = await this.db
      .select({ id: owners.id })
      .from(owners)
      .where(and(eq(owners.orgId, orgId), eq(owners.role, role)));
    return rows.length;
  }

  // ------------------------------------------------------------------ sessions

  /** Returns the raw token — the only moment it exists outside the browser. */
  async openSession(
    ownerId: string,
    ttlMs: number,
    meta: { userAgent?: string | null; ipAddress?: string | null } = {},
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + ttlMs);

    await this.db.insert(ownerSessions).values({
      ownerId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
    });

    return { token, expiresAt };
  }

  /**
   * The owner behind a live session, or null.
   *
   * Looked up by the token's hash, so the query is an index hit and no
   * comparison of secrets happens in application code.
   */
  async findBySessionToken(
    token: string,
  ): Promise<{ owner: OwnerRow; session: OwnerSessionRow } | null> {
    const [row] = await this.db
      .select({ owner: owners, session: ownerSessions })
      .from(ownerSessions)
      .innerJoin(owners, eq(owners.id, ownerSessions.ownerId))
      .where(
        and(eq(ownerSessions.tokenHash, hashToken(token)), gt(ownerSessions.expiresAt, new Date())),
      )
      .limit(1);
    return row ?? null;
  }

  async closeSession(token: string): Promise<void> {
    await this.db.delete(ownerSessions).where(eq(ownerSessions.tokenHash, hashToken(token)));
  }

  async closeAllSessions(ownerId: string): Promise<void> {
    await this.db.delete(ownerSessions).where(eq(ownerSessions.ownerId, ownerId));
  }

  /** Housekeeping. Expired rows are dead weight and a needless liability. */
  async purgeExpired(): Promise<void> {
    await this.db.delete(ownerSessions).where(lt(ownerSessions.expiresAt, new Date()));
  }

  /** Every live session for one owner, newest use first. */
  async sessions(ownerId: string): Promise<OwnerSessionRow[]> {
    return this.db
      .select()
      .from(ownerSessions)
      .where(and(eq(ownerSessions.ownerId, ownerId), gt(ownerSessions.expiresAt, new Date())))
      .orderBy(desc(sql`coalesce(${ownerSessions.lastUsedAt}, ${ownerSessions.createdAt})`));
  }

  /**
   * Revoke one session by id, scoped to its owner.
   *
   * Scoped as well as keyed: an id from a form must not be able to close
   * somebody else's session because it is a valid uuid.
   */
  async revokeSession(ownerId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(ownerSessions)
      .where(and(eq(ownerSessions.ownerId, ownerId), eq(ownerSessions.id, id)))
      .returning({ id: ownerSessions.id });
    return rows.length > 0;
  }

  /** Everything except the one in the caller's hand — "sign out everywhere else". */
  async revokeOtherSessions(ownerId: string, keepToken: string): Promise<number> {
    const rows = await this.db
      .delete(ownerSessions)
      .where(
        and(eq(ownerSessions.ownerId, ownerId), ne(ownerSessions.tokenHash, hashToken(keepToken))),
      )
      .returning({ id: ownerSessions.id });
    return rows.length;
  }

  /**
   * Record that a session was just used.
   *
   * Throttled to once a minute: this runs on every authenticated request, and a
   * write per request would turn a read-only page load into a write and put the
   * session row under constant lock contention for information nobody needs to
   * the second.
   */
  async touchSession(id: string, ownerId: string, lastUsedAt: Date | null): Promise<void> {
    if (lastUsedAt && Date.now() - lastUsedAt.getTime() < 60_000) return;

    const now = new Date();
    await this.db.update(ownerSessions).set({ lastUsedAt: now }).where(eq(ownerSessions.id, id));
    // The account's own clock, not only the session's. "Last seen" on the
    // people screen is the question an owner asks about somebody else, and
    // asking it of a session they cannot see is not an answer.
    await this.db.update(owners).set({ lastSeenAt: now }).where(eq(owners.id, ownerId));
  }

  // ----------------------------------------------------------- login attempts

  /**
   * How many failures in the window, for this email or this address.
   *
   * Either one counts. Locking only by email lets an attacker lock a real owner
   * out of their own site; locking only by address does nothing to an attempt
   * spread across a botnet.
   */
  async recentFailures(email: string, ipAddress: string | null, windowMs: number): Promise<number> {
    const since = new Date(Date.now() - windowMs);
    const rows = await this.db
      .select({ id: loginAttempts.id })
      .from(loginAttempts)
      .where(
        and(
          // Sign-in attempts only. Public form submissions share this table and
          // must not count here, or filling a contact form locks the owner out.
          eq(loginAttempts.kind, "login"),
          gt(loginAttempts.at, since),
          ipAddress
            ? or(
                eq(loginAttempts.email, email.toLowerCase()),
                eq(loginAttempts.ipAddress, ipAddress),
              )
            : eq(loginAttempts.email, email.toLowerCase()),
        ),
      );
    return rows.length;
  }

  async recordFailure(email: string, ipAddress: string | null): Promise<void> {
    await this.db
      .insert(loginAttempts)
      .values({ kind: "login", email: email.toLowerCase(), ipAddress });
  }

  /** Cleared on success, so a legitimate owner is never punished for typos. */
  async clearFailures(email: string, ipAddress: string | null): Promise<void> {
    await this.db
      .delete(loginAttempts)
      .where(
        and(
          eq(loginAttempts.kind, "login"),
          ipAddress
            ? or(
                eq(loginAttempts.email, email.toLowerCase()),
                eq(loginAttempts.ipAddress, ipAddress),
              )
            : eq(loginAttempts.email, email.toLowerCase()),
        ),
      );
  }
}
