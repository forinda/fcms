/**
 * Owners and their sessions. Rows in, rows out.
 */
import { sql, type ExpressionBuilder } from "@forinda/kickjs-db";

import type { Kdb, KdbSchema, OwnerRow, OwnerSessionRow } from "@forinda-cms/db";
import { hashToken, newSessionToken } from "@/shared/auth/tokens";

/** An id out of a URL must not reach a uuid column raw. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Failures for this email, or from this address when there is one. */
const byEmailOrAddress =
  (email: string, ipAddress: string | null) =>
  (eb: ExpressionBuilder<KdbSchema, "login_attempts">) =>
    ipAddress
      ? eb.or([eb("email", "=", email.toLowerCase()), eb("ipAddress", "=", ipAddress)])
      : eb("email", "=", email.toLowerCase());

export class OwnerRepository {
  constructor(private readonly db: Kdb) {}

  async findByEmail(email: string): Promise<OwnerRow | null> {
    const row = await this.db
      .selectFrom("owners")
      .selectAll()
      .where("email", "=", email.toLowerCase())
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  async count(): Promise<number> {
    const rows = await this.db.selectFrom("owners").select("id").limit(1).execute();
    return rows.length;
  }

  async create(values: {
    orgId: string;
    email: string;
    passwordHash: string;
    name?: string;
    role?: string;
  }): Promise<OwnerRow> {
    return this.db
      .insertInto("owners")
      .values({
        orgId: values.orgId,
        email: values.email.toLowerCase(),
        passwordHash: values.passwordHash,
        name: values.name ?? null,
        ...(values.role ? { role: values.role } : {}),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * A new password for one account.
   *
   * Scoped by organization like everything else that takes an id, even though
   * the only caller passes its own — the scope belongs on the write, not in a
   * check beside it.
   */
  async setPassword(orgId: string, id: string, passwordHash: string): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const rows = await this.db
      .updateTable("owners")
      .set({ passwordHash })
      .where("id", "=", id)
      .where("orgId", "=", orgId)
      .returning("id")
      .execute();
    return rows.length > 0;
  }

  async setName(orgId: string, id: string, name: string | null): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const rows = await this.db
      .updateTable("owners")
      .set({ name })
      .where("id", "=", id)
      .where("orgId", "=", orgId)
      .returning("id")
      .execute();
    return rows.length > 0;
  }

  /** Everyone who can sign in, oldest first — the order they were added. */
  async list(orgId: string): Promise<OwnerRow[]> {
    return this.db
      .selectFrom("owners")
      .selectAll()
      .where("orgId", "=", orgId)
      .orderBy("createdAt", "asc")
      .execute();
  }

  /**
   * One account, within one organization.
   *
   * `orgId` is not optional and not a filter applied afterwards: every id here
   * arrives from a URL, and an account is only ever managed by somebody in the
   * same organization. Looking one up unscoped and checking the org later is
   * the shape that becomes a cross-tenant hole the first time a caller forgets
   * the second half.
   */
  async findById(orgId: string, id: string): Promise<OwnerRow | null> {
    if (!UUID.test(id)) return null;
    const row = await this.db
      .selectFrom("owners")
      .selectAll()
      .where("id", "=", id)
      .where("orgId", "=", orgId)
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  async setRole(orgId: string, id: string, role: string): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const rows = await this.db
      .updateTable("owners")
      .set({ role })
      .where("id", "=", id)
      .where("orgId", "=", orgId)
      .returning("id")
      .execute();
    return rows.length > 0;
  }

  /**
   * Remove somebody.
   *
   * Their sessions go with them by the foreign key's cascade — an account that
   * is gone but whose browser still works is not gone.
   */
  async remove(orgId: string, id: string): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const rows = await this.db
      .deleteFrom("owners")
      .where("id", "=", id)
      .where("orgId", "=", orgId)
      .returning("id")
      .execute();
    return rows.length > 0;
  }

  /** How many accounts hold this role — asked before removing the last owner. */
  async countWithRole(orgId: string, role: string): Promise<number> {
    const rows = await this.db
      .selectFrom("owners")
      .select("id")
      .where("orgId", "=", orgId)
      .where("role", "=", role)
      .execute();
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

    await this.db
      .insertInto("owner_sessions")
      .values({
        ownerId,
        tokenHash: hashToken(token),
        expiresAt,
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
      })
      .execute();

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
  ): Promise<{ owner: OwnerRow; session: Pick<OwnerSessionRow, "id" | "lastUsedAt"> } | null> {
    // One query on every authenticated request, so the two session columns
    // anyone reads are aliased beside the owner's rather than fetched apart.
    const row = await this.db
      .selectFrom("owner_sessions as s")
      .innerJoin("owners", "owners.id", "s.ownerId")
      .selectAll("owners")
      .select(["s.id as sessionId", "s.lastUsedAt as sessionLastUsedAt"])
      .where("s.tokenHash", "=", hashToken(token))
      .where("s.expiresAt", ">", new Date())
      .limit(1)
      .executeTakeFirst();
    if (!row) return null;

    const { sessionId, sessionLastUsedAt, ...owner } = row;
    return { owner, session: { id: sessionId, lastUsedAt: sessionLastUsedAt } };
  }

  async closeSession(token: string): Promise<void> {
    await this.db.deleteFrom("owner_sessions").where("tokenHash", "=", hashToken(token)).execute();
  }

  async closeAllSessions(ownerId: string): Promise<void> {
    await this.db.deleteFrom("owner_sessions").where("ownerId", "=", ownerId).execute();
  }

  /** Housekeeping. Expired rows are dead weight and a needless liability. */
  async purgeExpired(): Promise<void> {
    await this.db.deleteFrom("owner_sessions").where("expiresAt", "<", new Date()).execute();
  }

  /** Every live session for one owner, newest use first. */
  async sessions(ownerId: string): Promise<OwnerSessionRow[]> {
    return this.db
      .selectFrom("owner_sessions")
      .selectAll()
      .where("ownerId", "=", ownerId)
      .where("expiresAt", ">", new Date())
      .orderBy(sql`coalesce(last_used_at, created_at)`, "desc")
      .execute();
  }

  /**
   * Revoke one session by id, scoped to its owner.
   *
   * Scoped as well as keyed: an id from a form must not be able to close
   * somebody else's session because it is a valid uuid.
   */
  async revokeSession(ownerId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .deleteFrom("owner_sessions")
      .where("ownerId", "=", ownerId)
      .where("id", "=", id)
      .returning("id")
      .execute();
    return rows.length > 0;
  }

  /** Everything except the one in the caller's hand — "sign out everywhere else". */
  async revokeOtherSessions(ownerId: string, keepToken: string): Promise<number> {
    const rows = await this.db
      .deleteFrom("owner_sessions")
      .where("ownerId", "=", ownerId)
      .where("tokenHash", "!=", hashToken(keepToken))
      .returning("id")
      .execute();
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
    await this.db
      .updateTable("owner_sessions")
      .set({ lastUsedAt: now })
      .where("id", "=", id)
      .execute();
    // The account's own clock, not only the session's. "Last seen" on the
    // people screen is the question an owner asks about somebody else, and
    // asking it of a session they cannot see is not an answer.
    await this.db
      .updateTable("owners")
      .set({ lastSeenAt: now })
      .where("id", "=", ownerId)
      .execute();
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
      .selectFrom("login_attempts")
      .select("id")
      // Sign-in attempts only. Public form submissions share this table and
      // must not count here, or filling a contact form locks the owner out.
      .where("kind", "=", "login")
      .where("at", ">", since)
      .where(byEmailOrAddress(email, ipAddress))
      .execute();
    return rows.length;
  }

  async recordFailure(email: string, ipAddress: string | null): Promise<void> {
    await this.db
      .insertInto("login_attempts")
      .values({ kind: "login", email: email.toLowerCase(), ipAddress })
      .execute();
  }

  /** Cleared on success, so a legitimate owner is never punished for typos. */
  async clearFailures(email: string, ipAddress: string | null): Promise<void> {
    await this.db
      .deleteFrom("login_attempts")
      .where("kind", "=", "login")
      .where(byEmailOrAddress(email, ipAddress))
      .execute();
  }
}
