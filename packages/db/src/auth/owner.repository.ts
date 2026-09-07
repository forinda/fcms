/**
 * Owners and their sessions. Rows in, rows out.
 */
import { and, eq, gt, lt } from "drizzle-orm";

import type { Db } from "../client.js";
import { ownerSessions, owners, type OwnerRow, type OwnerSessionRow } from "../schema/index.js";
import { hashToken, newSessionToken } from "./tokens.js";

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
  }): Promise<OwnerRow> {
    const [row] = await this.db
      .insert(owners)
      .values({
        orgId: values.orgId,
        email: values.email.toLowerCase(),
        passwordHash: values.passwordHash,
        name: values.name ?? null,
      })
      .returning();
    return row!;
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
}
