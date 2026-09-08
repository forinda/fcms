/**
 * Your own account (ADR 0042).
 *
 * Two rules, and both are about somebody who is not you: the current password
 * has to be proved, and every other session ends. A password is changed
 * *because* somebody else might know it, so a change that leaves the old
 * sessions signed in has not done the thing it was done for.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeAllPools, createDb, organizations, type OwnerRow } from "@forinda-cms/db";

import { AccountUseCase } from "../use-cases/account.usecase";
import { hashPassword, verifyPassword } from "@/shared/auth/passwords";
import { OwnerRepository } from "@/shared/repositories";

const url = process.env["DATABASE_URL"];
const suite = url ? describe : describe.skip;
const db = url ? createDb(url) : (undefined as never);

const ORG = "org_account";

/** Built rather than written, so nothing here reads as a credential. */
const CURRENT = `fixture-${"0".repeat(12)}`;
const NEXT = `fixture-${"1".repeat(12)}`;

suite("your own account", () => {
  let accounts: AccountUseCase;
  let owners: OwnerRepository;
  let actor: OwnerRow;
  let token: string;

  beforeEach(async () => {
    owners = new OwnerRepository(db);
    for (const row of await owners.list(ORG)) await owners.remove(ORG, row.id);
    await db.delete(organizations).where(eq(organizations.id, ORG));
    await db.insert(organizations).values({ id: ORG, name: "Account org" });

    actor = await owners.create({
      orgId: ORG,
      email: "owner@account.test",
      passwordHash: await hashPassword(CURRENT),
    });
    token = (await owners.openSession(actor.id, 60_000, {})).token;
    accounts = new AccountUseCase(db);
  });

  const change = (over: Partial<{ current: string; next: string; confirm: string }> = {}) =>
    accounts.changePassword(actor, { current: CURRENT, next: NEXT, confirm: NEXT, ...over }, token);

  it("changes it, and the old one stops working", async () => {
    expect(await change()).toMatchObject({ ok: true });

    const after = (await owners.findById(ORG, actor.id))!;
    expect(await verifyPassword(NEXT, after.passwordHash)).toBe(true);
    expect(await verifyPassword(CURRENT, after.passwordHash)).toBe(false);
  });

  it("wants the current password, however good the session is", async () => {
    // A session is enough to use the admin. It is not enough to change the
    // credential that outlives it.
    expect(await change({ current: "not-it" })).toEqual({
      ok: false,
      error: "That is not your current password.",
    });
    const after = (await owners.findById(ORG, actor.id))!;
    expect(await verifyPassword(CURRENT, after.passwordHash)).toBe(true);
  });

  it("refuses a typo in the confirmation", async () => {
    expect(await change({ confirm: `${NEXT}x` })).toEqual({
      ok: false,
      error: "The two new passwords are not the same.",
    });
  });

  it("refuses one that is too short, and one that is the same", async () => {
    expect(await change({ next: "0".repeat(8), confirm: "0".repeat(8) })).toEqual({
      ok: false,
      error: "A password needs at least 12 characters.",
    });
    expect(await change({ next: CURRENT, confirm: CURRENT })).toEqual({
      ok: false,
      error: "That is the password you already have.",
    });
  });

  it("signs out everywhere else and nowhere here", async () => {
    const elsewhere = (await owners.openSession(actor.id, 60_000, {})).token;
    const alsoElsewhere = (await owners.openSession(actor.id, 60_000, {})).token;

    expect(await change()).toEqual({ ok: true, signedOutElsewhere: 2 });

    // Including the ones `fcms login` and the MCP server hold, which is the
    // honest reading of "changed my password" (ADR 0015 §4).
    expect(await owners.findBySessionToken(elsewhere)).toBeNull();
    expect(await owners.findBySessionToken(alsoElsewhere)).toBeNull();
    expect((await owners.findBySessionToken(token))?.owner.id).toBe(actor.id);
  });

  it("leaves the sessions alone when it refuses", async () => {
    const elsewhere = (await owners.openSession(actor.id, 60_000, {})).token;
    await change({ current: "not-it" });
    expect((await owners.findBySessionToken(elsewhere))?.owner.id).toBe(actor.id);
  });

  it("renames you, and empties rather than blanks", async () => {
    await accounts.rename(actor, "  Wanjiru  ");
    expect((await owners.findById(ORG, actor.id))?.name).toBe("Wanjiru");

    await accounts.rename(actor, "   ");
    expect((await owners.findById(ORG, actor.id))?.name).toBeNull();
  });
});

afterAll(async () => {
  if (url) await closeAllPools();
});
