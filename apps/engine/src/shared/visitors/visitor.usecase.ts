/**
 * Visitor accounts (ADR 0020).
 *
 * Deliberately parallel to the owner's auth rather than shared with it: the
 * password hashing is the same function, and nothing else is. A visitor session
 * is not an actor, cannot become one, and the admin has no code path that reads
 * its cookie.
 */
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Db, Scope, VisitorRow } from "@forinda-cms/db";
import { visitorSaves, visitorSessions, visitors } from "@forinda-cms/db";

import { CURRENT_SCOPE } from "@/contributors/site.contributor";
import { DB } from "@/shared/db";
import { hashPassword, verifyPassword } from "@/shared/auth/passwords";
import { hashToken, newSessionToken } from "@/shared/auth/tokens";

/** Two weeks, like an owner's — a visitor is no less annoyed by signing in again. */
export const VISITOR_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Long enough to be a password, short enough that people still choose one. */
export const MIN_PASSWORD = 10;

export class VisitorCredentialsError extends Error {
  constructor() {
    super("That email and password do not match an account.");
    this.name = "VisitorCredentialsError";
  }
}

export interface VisitorSession {
  readonly token: string;
  readonly expiresAt: Date;
  readonly visitor: VisitorRow;
}

@Service({ scope: Lifetime.REQUEST })
export class VisitorUseCase {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CURRENT_SCOPE) private readonly scope: Scope,
  ) {}

  /**
   * Register, and sign in.
   *
   * Scoped to this site: the same address on two sites is two accounts, because
   * the sites are two businesses (ADR 0020 §1).
   */
  async register(input: {
    email: string;
    password: string;
    name?: string;
  }): Promise<VisitorSession> {
    const email = input.email.trim().toLowerCase();
    if (!email.includes("@")) throw new VisitorCredentialsError();
    if (input.password.length < MIN_PASSWORD) {
      throw new Error(`Choose a password of at least ${MIN_PASSWORD} characters.`);
    }

    const existing = await this.byEmail(email);
    // The same error as a wrong password on purpose: "that address is taken" is
    // a way to ask a site which of your customers it has.
    if (existing) throw new VisitorCredentialsError();

    const [row] = await this.db
      .insert(visitors)
      .values({
        siteId: this.scope.siteId,
        email,
        passwordHash: await hashPassword(input.password),
        name: input.name?.trim() || null,
      })
      .returning();

    return this.open(row!);
  }

  async signIn(input: { email: string; password: string }): Promise<VisitorSession> {
    const visitor = await this.byEmail(input.email.trim().toLowerCase());
    const ok = await verifyPassword(input.password, visitor?.passwordHash ?? DUMMY);
    if (!visitor || !ok) throw new VisitorCredentialsError();

    return this.open(visitor);
  }

  /** The visitor behind a live session token, or nothing. */
  async fromToken(token: string | undefined): Promise<VisitorRow | null> {
    if (!token) return null;

    const [row] = await this.db
      .select({ visitor: visitors })
      .from(visitorSessions)
      .innerJoin(visitors, eq(visitors.id, visitorSessions.visitorId))
      .where(
        and(
          eq(visitorSessions.tokenHash, hashToken(token)),
          gt(visitorSessions.expiresAt, new Date()),
          // Scoped, so a token minted on one site cannot be replayed on another
          // served by the same install.
          eq(visitors.siteId, this.scope.siteId),
        ),
      )
      .limit(1);

    return row?.visitor ?? null;
  }

  async signOut(token: string): Promise<void> {
    await this.db.delete(visitorSessions).where(eq(visitorSessions.tokenHash, hashToken(token)));
  }

  // ------------------------------------------------------------------- saves

  async save(visitorId: string, typeKey: string, entryId: string): Promise<void> {
    await this.db
      .insert(visitorSaves)
      .values({ visitorId, typeKey, entryId })
      // Saving twice is saving once. A unique index makes that true rather than
      // a race the second click loses.
      .onConflictDoNothing();
  }

  async unsave(visitorId: string, entryId: string): Promise<void> {
    await this.db
      .delete(visitorSaves)
      .where(and(eq(visitorSaves.visitorId, visitorId), eq(visitorSaves.entryId, entryId)));
  }

  async saved(visitorId: string): Promise<string[]> {
    const rows = await this.db
      .select({ entryId: visitorSaves.entryId })
      .from(visitorSaves)
      .where(eq(visitorSaves.visitorId, visitorId));
    return rows.map((row) => row.entryId);
  }

  /** Expired sessions, cleared on the same schedule owners' are. */
  async purgeExpired(): Promise<void> {
    await this.db.delete(visitorSessions).where(lt(visitorSessions.expiresAt, new Date()));
  }

  private async byEmail(email: string): Promise<VisitorRow | null> {
    const [row] = await this.db
      .select()
      .from(visitors)
      .where(and(eq(visitors.siteId, this.scope.siteId), eq(visitors.email, email)))
      .limit(1);
    return row ?? null;
  }

  private async open(visitor: VisitorRow): Promise<VisitorSession> {
    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + VISITOR_SESSION_TTL_MS);

    await this.db.insert(visitorSessions).values({
      visitorId: visitor.id,
      tokenHash: hashToken(token),
      expiresAt,
    });

    return { token, expiresAt, visitor };
  }
}

/**
 * Verified against when the address is unknown, so a failed sign-in does the
 * same work either way — the response time must not answer "does this person
 * have an account here".
 */
const DUMMY = await hashPassword("dummy-password-for-constant-time-checks");
