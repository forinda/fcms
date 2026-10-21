/**
 * Listing and revoking sessions.
 *
 * The property worth holding is the one ADR 0015 §4 promised when it chose
 * sessions over an API-key table: a token held by a terminal or an agent can be
 * seen and revoked from the admin, exactly like a browser's. Until this screen
 * existed that was a claim; these keep it one.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "@forinda/kickjs-db";
import { closeAllPools, createDb, organizations } from "@forinda-cms/db";

import { LoginUseCase, ProvisionOwnerUseCase } from "@/shared/auth/auth.usecase";
import { AuthenticateUseCase } from "@/shared/auth/auth.usecase";
import { SessionsUseCase } from "../use-cases/sessions.usecase";
import { standalone } from "@/shared/standalone";

const url = process.env["DATABASE_URL"];
const suite = url ? describe : describe.skip;
const db = url ? createDb(url) : (undefined as never);

const ORG = "org_sessions";
const EMAIL = "owner@example.test";
const PASSWORD = "a-long-enough-password";

suite("sessions", () => {
  let ownerId: string;

  beforeEach(async () => {
    await db.deleteFrom("login_attempts").execute();
    await db.deleteFrom("owner_sessions").execute();
    await db.deleteFrom("owners").execute();
    await db.deleteFrom("organizations").where(eq(organizations.id, ORG)).execute();
    await db.insertInto("organizations").values({ id: ORG, name: "Sessions org" }).execute();

    const owner = await standalone(db)(ProvisionOwnerUseCase).execute({
      orgId: ORG,
      email: EMAIL,
      password: PASSWORD,
    });
    ownerId = owner!.id;
  });

  const signIn = (userAgent: string) =>
    standalone(db)(LoginUseCase).execute({
      email: EMAIL,
      password: PASSWORD,
      userAgent,
      ipAddress: "::1",
    });

  it("names a terminal a terminal, so it can be told from a browser", async () => {
    await signIn("fcms");
    await signIn("Mozilla/5.0 (Macintosh) Chrome/140.0");

    const rows = await standalone(db)(SessionsUseCase).list(ownerId, undefined);
    expect(rows.map((r) => r.what).sort()).toEqual(["Chrome", "Command line (fcms)"]);
  });

  it("marks which one is making the request", async () => {
    const mine = await signIn("Chrome/140");
    await signIn("fcms");

    const rows = await standalone(db)(SessionsUseCase).list(ownerId, mine.token);
    expect(rows.filter((r) => r.current)).toHaveLength(1);
    expect(rows.find((r) => r.current)!.what).toBe("Chrome");
  });

  it("revokes another session, and that token stops working immediately", async () => {
    const browser = await signIn("Chrome/140");
    const cli = await signIn("fcms");

    const sessions = standalone(db)(SessionsUseCase);
    const target = (await sessions.list(ownerId, browser.token)).find((r) => !r.current)!;

    expect(await sessions.revoke(ownerId, target.id, browser.token)).toBe(true);

    const auth = standalone(db)(AuthenticateUseCase);
    expect(await auth.execute(cli.token)).toBeNull();
    // And the one doing the revoking is untouched.
    expect(await auth.execute(browser.token)).not.toBeNull();
  });

  it("refuses to revoke the session making the request", async () => {
    // The button for that is Sign out; a revoke that logs you out mid-list
    // reads as a bug.
    const mine = await signIn("Chrome/140");
    const sessions = standalone(db)(SessionsUseCase);
    const current = (await sessions.list(ownerId, mine.token)).find((r) => r.current)!;

    expect(await sessions.revoke(ownerId, current.id, mine.token)).toBe(false);
    expect(await standalone(db)(AuthenticateUseCase).execute(mine.token)).not.toBeNull();
  });

  it("signs out everywhere else, keeping this one", async () => {
    const mine = await signIn("Chrome/140");
    const cli = await signIn("fcms");
    const other = await signIn("Firefox/130");

    expect(await standalone(db)(SessionsUseCase).revokeOthers(ownerId, mine.token)).toBe(2);

    const auth = standalone(db)(AuthenticateUseCase);
    expect(await auth.execute(cli.token)).toBeNull();
    expect(await auth.execute(other.token)).toBeNull();
    expect(await auth.execute(mine.token)).not.toBeNull();
  });

  it("records that a session was used, so the list can say when", async () => {
    const mine = await signIn("Chrome/140");
    expect(
      (await standalone(db)(SessionsUseCase).list(ownerId, mine.token))[0]!.lastUsed,
    ).toBeNull();

    await standalone(db)(AuthenticateUseCase).execute(mine.token);

    const [row] = await standalone(db)(SessionsUseCase).list(ownerId, mine.token);
    expect(row!.lastUsed).toBeInstanceOf(Date);
  });

  it("writes that at most once a minute, not on every request", async () => {
    const mine = await signIn("Chrome/140");
    const recently = new Date(Date.now() - 10_000);
    await db.updateTable("owner_sessions").set({ lastUsedAt: recently }).execute();

    await standalone(db)(AuthenticateUseCase).execute(mine.token);

    const [row] = await standalone(db)(SessionsUseCase).list(ownerId, mine.token);
    expect(row!.lastUsed).toEqual(recently);
  });
});

afterAll(async () => {
  if (url) await closeAllPools();
});
