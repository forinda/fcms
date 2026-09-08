/**
 * Who can sign in, and who can change that (ADR 0041).
 *
 * Three refusals carry the weight here, and each one is a way an install can
 * end up with nobody able to run it: promoting yourself, removing yourself, and
 * removing the last owner.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeAllPools, createDb, organizations, type OwnerRow } from "@forinda-cms/db";

import { PeopleUseCase } from "../use-cases/people.usecase";
import { OwnerRepository } from "@/shared/repositories";

const url = process.env["DATABASE_URL"];
const suite = url ? describe : describe.skip;
const db = url ? createDb(url) : (undefined as never);

const ORG = "org_people";
const OTHER_ORG = "org_people_other";

suite("people", () => {
  let staff: PeopleUseCase;
  let owners: OwnerRepository;
  let owner: OwnerRow;

  const asOwner = () => ({ actor: owner });

  beforeEach(async () => {
    owners = new OwnerRepository(db);
    // `owners_email` is unique across the whole install, not per organization,
    // so this suite keeps to its own domain and clears anything of its own a
    // previous run left behind.
    for (const row of await owners.list(ORG)) await owners.remove(ORG, row.id);
    for (const row of await owners.list(OTHER_ORG)) await owners.remove(OTHER_ORG, row.id);
    await db.delete(organizations).where(eq(organizations.id, OTHER_ORG));
    await db.delete(organizations).where(eq(organizations.id, ORG));
    await db.insert(organizations).values({ id: ORG, name: "People org" });

    owner = await owners.create({
      orgId: ORG,
      email: "owner@people.test",
      passwordHash: "not-a-real-hash",
      role: "owner",
    });
    staff = new PeopleUseCase(db);
  });

  it("adds somebody with the role they were given", async () => {
    expect(
      await staff.add(asOwner(), {
        email: "Reception@People.test",
        name: "Reception",
        password: "front-desk-password",
        role: "editor",
      }),
    ).toEqual({ ok: true });

    // Addresses are compared lowercased, so "Reception@" and "reception@" are
    // the same person rather than two accounts.
    const added = await owners.findByEmail("reception@people.test");
    expect(added?.role).toBe("editor");
    expect(added?.passwordHash).not.toContain("front-desk-password");
  });

  it("refuses a password short enough to guess", async () => {
    const result = await staff.add(asOwner(), {
      email: "short@people.test",
      name: "",
      password: "letmein",
      role: "editor",
    });
    expect(result).toEqual({ ok: false, error: "A password needs at least 12 characters." });
  });

  it("refuses an address somebody already signs in with", async () => {
    await staff.add(asOwner(), {
      email: "twice@people.test",
      name: "",
      password: "a-long-enough-password",
      role: "editor",
    });
    const again = await staff.add(asOwner(), {
      email: "twice@people.test",
      name: "",
      password: "another-long-password",
      role: "editor",
    });
    expect(again).toEqual({ ok: false, error: "Somebody already signs in with that address." });
  });

  it("lets nobody but an owner add or remove people", async () => {
    await staff.add(asOwner(), {
      email: "editor@people.test",
      name: "",
      password: "a-long-enough-password",
      role: "editor",
    });
    const editor = (await owners.findByEmail("editor@people.test"))!;

    // Including making themselves an owner, which is the interesting attempt.
    expect(
      await staff.add(
        { actor: editor },
        {
          email: "sneaky@people.test",
          name: "",
          password: "a-long-enough-password",
          role: "owner",
        },
      ),
    ).toEqual({ ok: false, error: "Only an owner can add or remove people." });
  });

  it("refuses to let anybody change their own role", async () => {
    // An owner who demotes themselves has locked themselves out of the screen
    // that would undo it.
    expect(await staff.setRole(asOwner(), owner.id, "viewer")).toEqual({
      ok: false,
      error: "You cannot change your own role.",
    });
  });

  it("refuses to remove your own account", async () => {
    expect(await staff.remove(asOwner(), owner.id)).toEqual({
      ok: false,
      error: "You cannot remove your own account.",
    });
  });

  it("keeps the last owner, even from another owner", async () => {
    await staff.add(asOwner(), {
      email: "second@people.test",
      name: "",
      password: "a-long-enough-password",
      role: "owner",
    });
    const second = (await owners.findByEmail("second@people.test"))!;

    // Two owners: either may go.
    expect(await staff.remove({ actor: second }, owner.id)).toEqual({ ok: true });

    // One left: it may not.
    expect(await staff.remove({ actor: owner }, second.id)).toEqual({
      ok: false,
      error: "This is the last owner. Make somebody else an owner first.",
    });
    expect(await staff.setRole({ actor: owner }, second.id, "editor")).toEqual({
      ok: false,
      error: "This is the last owner, so its role cannot change.",
    });
  });

  it("cannot reach an account in another organization", async () => {
    // Today an install has one organization, so this is unreachable — and
    // ADR 0008 exists because that stops being true. An id out of a URL must
    // not be able to demote or delete somebody in a different one, and the
    // answer has to be the one an unknown id gets, or the difference between
    // "not yours" and "does not exist" is itself an answer.
    await db.insert(organizations).values({ id: OTHER_ORG, name: "Somebody else" });
    const stranger = await owners.create({
      orgId: OTHER_ORG,
      email: "stranger@people.test",
      passwordHash: "not-a-real-hash",
      role: "owner",
    });

    expect(await staff.setRole(asOwner(), stranger.id, "viewer")).toEqual({
      ok: false,
      error: "That account no longer exists.",
    });
    expect(await staff.remove(asOwner(), stranger.id)).toEqual({
      ok: false,
      error: "That account is already gone.",
    });

    // And the row is untouched, not merely reported as missing.
    const after = await owners.findById(OTHER_ORG, stranger.id);
    expect(after?.role).toBe("owner");

    await owners.remove(OTHER_ORG, stranger.id);
    await db.delete(organizations).where(eq(organizations.id, OTHER_ORG));
  });

  it("treats an unknown role as the least there is", async () => {
    await staff.add(asOwner(), {
      email: "odd@people.test",
      name: "",
      password: "a-long-enough-password",
      role: "superuser",
    });
    expect((await owners.findByEmail("odd@people.test"))?.role).toBe("viewer");
  });
});

afterAll(async () => {
  if (url) await closeAllPools();
});
