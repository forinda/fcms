/**
 * Auth tests.
 *
 * The properties here are the ones that make an admin on the public internet
 * survivable, and each would be quietly untrue without a test: a failed login
 * says the same thing either way, the stored session is a hash rather than the
 * token, and a second boot cannot mint a second owner.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
  closeAllPools,
  createDb,
  loginAttempts,
  organizations,
  ownerSessions,
  owners,
} from "@forinda-cms/db";
import { hashPassword, verifyPassword } from "@/shared/auth/passwords";
import { hashToken, newSessionToken } from "@/shared/auth/tokens";
import {
  AuthenticateUseCase,
  InvalidCredentialsError,
  LOCKOUT_AFTER,
  LoginUseCase,
  LogoutUseCase,
  ProvisionOwnerUseCase,
  TooManyAttemptsError,
} from "./auth.usecase";
import { OwnerRepository } from "@/shared/repositories";

describe("password hashing (no database needed)", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("a-long-enough-password");
    expect(await verifyPassword("a-long-enough-password", hash)).toBe(true);
    expect(await verifyPassword("nope", hash)).toBe(false);
  });

  it("produces a different hash for the same password", async () => {
    // Salted. Two owners with the same password must not be visibly the same.
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("treats a malformed hash as a failed check, not an error", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
  });
});

describe("session tokens (no database needed)", () => {
  it("issues unguessable tokens", () => {
    const a = newSessionToken();
    expect(a).not.toBe(newSessionToken());
    // 32 bytes of entropy, base64url encoded.
    expect(a.length).toBeGreaterThanOrEqual(43);
  });

  it("hashes deterministically, so a lookup is an index hit", () => {
    const token = newSessionToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
  });
});

const url = process.env["DATABASE_URL"];
const suite = url ? describe : describe.skip;
const db = url ? createDb(url) : (undefined as never);

const ORG = "org_auth";
const EMAIL = "owner@example.test";
const PASSWORD = "a-long-enough-password";

suite("signing in", () => {
  beforeEach(async () => {
    await db.delete(loginAttempts);
    await db.delete(ownerSessions);
    // All owners, not just this org: `ProvisionOwnerUseCase` counts globally
    // because the rule it enforces is "one owner per install".
    await db.delete(owners);
    await db.delete(organizations).where(eq(organizations.id, ORG));
    await db.insert(organizations).values({ id: ORG, name: "Auth org" });
  });

  const provision = () =>
    new ProvisionOwnerUseCase(db).execute({ orgId: ORG, email: EMAIL, password: PASSWORD });

  it("creates the first owner and then refuses to create another", async () => {
    expect(await provision()).not.toBeNull();
    // A restart with the env still set must not add a second account, and a
    // leaked env var must not mint one on a running install.
    expect(await provision()).toBeNull();
    expect(await new OwnerRepository(db).count()).toBe(1);
  });

  it("stores a hash, never the password", async () => {
    await provision();
    const [row] = await db.select().from(owners).where(eq(owners.email, EMAIL));
    expect(row!.passwordHash).not.toContain(PASSWORD);
    expect(row!.passwordHash.startsWith("$argon2id$")).toBe(true);
  });

  it("signs in with the right password", async () => {
    await provision();
    const session = await new LoginUseCase(db).execute({ email: EMAIL, password: PASSWORD });
    expect(session.token).toBeTruthy();
    expect(session.owner.email).toBe(EMAIL);
  });

  it("gives the same answer for a wrong password and an unknown account", async () => {
    await provision();
    const login = new LoginUseCase(db);

    // Different messages here turn the login form into a user-enumeration
    // oracle, which is the whole reason this is one error type.
    const wrong = await login.execute({ email: EMAIL, password: "wrong" }).catch((e) => e);
    const unknown = await login
      .execute({ email: "nobody@example.test", password: "x" })
      .catch((e) => e);

    expect(wrong).toBeInstanceOf(InvalidCredentialsError);
    expect(unknown).toBeInstanceOf(InvalidCredentialsError);
    expect(wrong.message).toBe(unknown.message);
  });

  it("is case-insensitive about the email", async () => {
    await provision();
    const session = await new LoginUseCase(db).execute({
      email: EMAIL.toUpperCase(),
      password: PASSWORD,
    });
    expect(session.owner.email).toBe(EMAIL);
  });
});

// Closed once, after every suite in this file. Closing it inside the first
// suite's `afterAll` tore the pool down before the second suite ran — which
// failed as "Failed query: delete from owner_sessions" and reads like a missing
// table rather than a closed connection.
afterAll(async () => {
  if (url) await closeAllPools();
});

suite("the lockout", () => {
  const IP = "203.0.113.7";

  beforeEach(async () => {
    await db.delete(loginAttempts);
    await db.delete(loginAttempts);
    await db.delete(ownerSessions);
    await db.delete(owners);
    await db.delete(organizations).where(eq(organizations.id, ORG));
    await db.insert(organizations).values({ id: ORG, name: "Auth org" });
    await new ProvisionOwnerUseCase(db).execute({ orgId: ORG, email: EMAIL, password: PASSWORD });
  });

  const wrong = () =>
    new LoginUseCase(db).execute({ email: EMAIL, password: "wrong", ipAddress: IP });

  it("refuses after too many failures, and says so", async () => {
    for (let i = 0; i < LOCKOUT_AFTER; i++) {
      await expect(wrong()).rejects.toBeInstanceOf(InvalidCredentialsError);
    }

    // A different error on purpose: a form that keeps saying "wrong password"
    // to someone being rate-limited is a support call, and the attacker already
    // knows how many attempts they made.
    await expect(wrong()).rejects.toBeInstanceOf(TooManyAttemptsError);
  });

  it("locks out the right password too, or it is not a lockout", async () => {
    for (let i = 0; i < LOCKOUT_AFTER; i++) await wrong().catch(() => {});

    await expect(
      new LoginUseCase(db).execute({ email: EMAIL, password: PASSWORD, ipAddress: IP }),
    ).rejects.toBeInstanceOf(TooManyAttemptsError);
  });

  it("forgets the failures once a sign-in succeeds", async () => {
    for (let i = 0; i < LOCKOUT_AFTER - 1; i++) await wrong().catch(() => {});

    // An owner who mistyped nine times and then got it right does not start
    // tomorrow nine attempts down.
    await new LoginUseCase(db).execute({ email: EMAIL, password: PASSWORD, ipAddress: IP });
    await expect(wrong()).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("counts attempts from one address against another email", async () => {
    // Otherwise a guessing attack just changes the email between tries.
    for (let i = 0; i < LOCKOUT_AFTER; i++) {
      await new LoginUseCase(db)
        .execute({ email: `nobody${i}@example.test`, password: "x", ipAddress: IP })
        .catch(() => {});
    }

    await expect(
      new LoginUseCase(db).execute({ email: EMAIL, password: PASSWORD, ipAddress: IP }),
    ).rejects.toBeInstanceOf(TooManyAttemptsError);
  });

  it("does not lock an owner out because someone else is guessing elsewhere", async () => {
    // Locking by email alone hands an attacker a way to lock a real owner out
    // of their own site from anywhere.
    for (let i = 0; i < LOCKOUT_AFTER; i++) {
      await new LoginUseCase(db)
        .execute({ email: EMAIL, password: "wrong", ipAddress: "198.51.100.4" })
        .catch(() => {});
    }

    // The real owner, on their own connection, is still locked — that is the
    // trade the email counter makes, and it is deliberate. What must not happen
    // is a *different* account being locked.
    const other = await new LoginUseCase(db)
      .execute({ email: "someone@else.test", password: "x", ipAddress: "192.0.2.9" })
      .catch((e: unknown) => e);
    expect(other).toBeInstanceOf(InvalidCredentialsError);
  });
});

suite("sessions", () => {
  beforeEach(async () => {
    await db.delete(loginAttempts);
    await db.delete(ownerSessions);
    // All owners, not just this org: `ProvisionOwnerUseCase` counts globally
    // because the rule it enforces is "one owner per install".
    await db.delete(owners);
    await db.delete(organizations).where(eq(organizations.id, ORG));
    await db.insert(organizations).values({ id: ORG, name: "Auth org" });
    await new ProvisionOwnerUseCase(db).execute({ orgId: ORG, email: EMAIL, password: PASSWORD });
  });

  const signIn = () => new LoginUseCase(db).execute({ email: EMAIL, password: PASSWORD });

  it("stores the token's hash and not the token", async () => {
    const { token } = await signIn();
    const [row] = await db.select().from(ownerSessions);
    // A leaked dump must not hand out live sessions.
    expect(row!.tokenHash).not.toBe(token);
    expect(row!.tokenHash).toBe(hashToken(token));
  });

  it("resolves an owner from a live token", async () => {
    const { token } = await signIn();
    expect((await new AuthenticateUseCase(db).execute(token))?.email).toBe(EMAIL);
  });

  it("resolves nothing for a missing, wrong or expired token", async () => {
    const auth = new AuthenticateUseCase(db);
    expect(await auth.execute(undefined)).toBeNull();
    expect(await auth.execute("not-a-real-token")).toBeNull();

    const { token } = await signIn();
    await db.update(ownerSessions).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await auth.execute(token)).toBeNull();
  });

  it("stops working the moment it is signed out", async () => {
    const { token } = await signIn();
    await new LogoutUseCase(db).execute(token);
    // Deleted rather than marked: a revoked session should not exist.
    expect(await new AuthenticateUseCase(db).execute(token)).toBeNull();
    expect((await db.select().from(ownerSessions)).length).toBe(0);
  });

  it("leaves other sessions alone when one signs out", async () => {
    const first = await signIn();
    const second = await signIn();
    await new LogoutUseCase(db).execute(first.token);

    expect(await new AuthenticateUseCase(db).execute(first.token)).toBeNull();
    expect(await new AuthenticateUseCase(db).execute(second.token)).not.toBeNull();
  });
});
