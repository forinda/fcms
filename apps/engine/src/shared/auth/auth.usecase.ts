/**
 * Signing in, out, and finding out who is asking.
 *
 * The security decisions live here rather than in the controller, so they are
 * testable without an HTTP server and cannot be quietly skipped by a second
 * caller.
 */
import { Inject, Service } from "@forinda/kickjs";
import type { Db, OwnerRow } from "@forinda-cms/db";
import { OwnerRepository } from "@/shared/repositories/owner.repository";
import { hashPassword, verifyPassword } from "@/shared/auth/passwords";

import { DB } from "@/shared/db";

/**
 * A hash of a value nobody will supply.
 *
 * Verified against when the email is unknown, so a failed login does the same
 * work either way. Without it the response time answers "does this account
 * exist" — turning the login form into a user-enumeration oracle.
 */
const DUMMY_HASH = await hashPassword("dummy-password-for-constant-time-checks");

/** Two weeks. Long enough not to annoy, short enough that a stolen cookie expires. */
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The lockout.
 *
 * Ten failures in fifteen minutes, counted per email **and** per address, then
 * a wait. The numbers are chosen against the two ways this is wrong: too strict
 * and an owner who mistypes twice on a phone keyboard is locked out of their
 * own business; too loose and an online guessing attack is merely slowed.
 *
 * Ten is above any plausible number of honest typos and far below the volume a
 * guessing attack needs. The counter clears on a successful sign-in, so a
 * legitimate owner never carries yesterday's mistakes.
 */
export const LOCKOUT_AFTER = 10;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Too many failures. Distinct from `InvalidCredentialsError` on purpose.
 *
 * Telling the caller they are locked out reveals nothing an attacker cannot
 * already measure — they know how many attempts they made — while a login form
 * that keeps saying "wrong password" to someone being rate-limited is a support
 * call and a bad afternoon.
 */
export class TooManyAttemptsError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("Too many sign-in attempts. Wait a few minutes and try again.");
    this.name = "TooManyAttemptsError";
  }
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
  readonly userAgent?: string | null;
  readonly ipAddress?: string | null;
}

export interface Session {
  readonly token: string;
  readonly expiresAt: Date;
  readonly owner: OwnerRow;
}

export class InvalidCredentialsError extends Error {
  constructor() {
    // One message for both causes, deliberately. "No such user" and "wrong
    // password" as separate answers is the same oracle as the timing one.
    super("Invalid email or password.");
    this.name = "InvalidCredentialsError";
  }
}

@Service()
export class LoginUseCase {
  private readonly owners: OwnerRepository;

  constructor(@Inject(DB) db: Db) {
    this.owners = new OwnerRepository(db);
  }

  async execute(input: LoginInput): Promise<Session> {
    const ip = input.ipAddress ?? null;

    // Checked before the password is verified: argon2 is deliberately expensive,
    // so verifying first would make the lockout itself a way to spend the
    // server's CPU.
    const failures = await this.owners.recentFailures(input.email, ip, LOCKOUT_WINDOW_MS);
    if (failures >= LOCKOUT_AFTER) throw new TooManyAttemptsError(LOCKOUT_WINDOW_MS);

    const owner = await this.owners.findByEmail(input.email);

    // Verified either way, against the real hash or the dummy, so the work is
    // comparable whether or not the account exists.
    const ok = await verifyPassword(input.password, owner?.passwordHash ?? DUMMY_HASH);
    if (!owner || !ok) {
      await this.owners.recordFailure(input.email, ip);
      throw new InvalidCredentialsError();
    }

    // Cleared on success, so an owner who mistyped four times and then got it
    // right does not start tomorrow four attempts down.
    await this.owners.clearFailures(input.email, ip);

    const { token, expiresAt } = await this.owners.openSession(owner.id, SESSION_TTL_MS, {
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
    });

    return { token, expiresAt, owner };
  }
}

@Service()
export class LogoutUseCase {
  private readonly owners: OwnerRepository;

  constructor(@Inject(DB) db: Db) {
    this.owners = new OwnerRepository(db);
  }

  /** Deletes the session rather than marking it — a revoked session should not exist. */
  async execute(token: string): Promise<void> {
    await this.owners.closeSession(token);
  }
}

@Service()
export class AuthenticateUseCase {
  private readonly owners: OwnerRepository;

  constructor(@Inject(DB) db: Db) {
    this.owners = new OwnerRepository(db);
  }

  async execute(token: string | undefined): Promise<OwnerRow | null> {
    if (!token) return null;
    const found = await this.owners.findBySessionToken(token);
    if (!found) return null;

    // Recorded here because this is the one place every authenticated request
    // passes through. Throttled inside the repository — the value is "was this
    // session used recently", not a precise timestamp.
    await this.owners.touchSession(found.session.id, found.owner.id, found.session.lastUsedAt);
    return found.owner;
  }
}

/**
 * Create the first owner, once.
 *
 * Refuses if any owner exists, so a restart with the env still set cannot
 * silently add a second account — and so a compromised env var cannot mint one
 * on an install that is already running.
 */
@Service()
export class ProvisionOwnerUseCase {
  private readonly owners: OwnerRepository;

  constructor(@Inject(DB) db: Db) {
    this.owners = new OwnerRepository(db);
  }

  async execute(input: {
    orgId: string;
    email: string;
    password: string;
  }): Promise<OwnerRow | null> {
    if ((await this.owners.count()) > 0) return null;
    return this.owners.create({
      orgId: input.orgId,
      email: input.email,
      passwordHash: await hashPassword(input.password),
    });
  }
}
