/**
 * How often a stranger may post (ADR 0020 §4).
 *
 * The property worth holding is the namespacing: a burst of submissions must
 * not lock the owner out of signing in, or a spam wave becomes a denial of
 * service against the person who has to clean it up.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeAllPools, createDb, loginAttempts, organizations, owners } from "@forinda-cms/db";
import { eq } from "drizzle-orm";

import { LoginUseCase, ProvisionOwnerUseCase } from "@/shared/auth/auth.usecase";
import { SUBMISSIONS_ALLOWED, SubmissionLimitUseCase } from "../submission-limit.usecase";

const url = process.env["DATABASE_URL"];
const suite = url ? describe : describe.skip;
const db = url ? createDb(url) : (undefined as never);

const ORG = "org_submit";
const IP = "203.0.113.9";

suite("submission limits", () => {
  let limit: SubmissionLimitUseCase;

  beforeEach(async () => {
    await db.delete(loginAttempts);
    await db.delete(owners);
    await db.delete(organizations).where(eq(organizations.id, ORG));
    await db.insert(organizations).values({ id: ORG, name: "Submit org" });

    limit = new SubmissionLimitUseCase(db);
  });

  it("allows a person and stops a script", async () => {
    for (let i = 0; i < SUBMISSIONS_ALLOWED; i++) {
      expect(await limit.allow("enquiry", null, IP)).toBe(true);
      await limit.record("enquiry", null, IP);
    }

    expect(await limit.allow("enquiry", null, IP)).toBe(false);
  });

  it("does not lock the owner out of their own admin", async () => {
    // The reason the key is namespaced. Without it, filling a contact form
    // enough times would rate-limit sign-in — turning spam into a denial of
    // service against the one person who can clear it.
    await new ProvisionOwnerUseCase(db).execute({
      orgId: ORG,
      email: "owner@example.test",
      password: "a-long-enough-password",
    });

    for (let i = 0; i < SUBMISSIONS_ALLOWED * 2; i++) await limit.record("enquiry", null, IP);

    const session = await new LoginUseCase(db).execute({
      email: "owner@example.test",
      password: "a-long-enough-password",
      ipAddress: IP,
    });
    expect(session.token).toBeTruthy();
  });

  it("counts a signed-in visitor separately from an anonymous one", async () => {
    for (let i = 0; i < SUBMISSIONS_ALLOWED; i++) await limit.record("review", "visitor-1", null);

    expect(await limit.allow("review", "visitor-1", null)).toBe(false);
    expect(await limit.allow("review", "visitor-2", null)).toBe(true);
  });
});

afterAll(async () => {
  if (url) await closeAllPools();
});
