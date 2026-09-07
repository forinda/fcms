/**
 * Visitor accounts (ADR 0020).
 *
 * The properties that matter are the separations: a visitor is not an owner, a
 * visitor session is not an actor, and an account on one site is not an account
 * on another served by the same install.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  closeAllPools,
  createDb,
  organizations,
  sites,
  visitorSaves,
  visitorSessions,
  visitors,
} from "@forinda-cms/db";

import { AuthenticateUseCase } from "@/shared/auth/auth.usecase";
import { VisitorCredentialsError, VisitorUseCase } from "../visitor.usecase";

const url = process.env["DATABASE_URL"];
const suite = url ? describe : describe.skip;
const db = url ? createDb(url) : (undefined as never);

const ORG = "org_visitors";
const SITE = "site_visitors";
const OTHER = "site_visitors_other";

const EMAIL = "guest@example.test";
const PASSWORD = "a-long-enough-password";

suite("visitors", () => {
  let here: VisitorUseCase;
  let elsewhere: VisitorUseCase;

  beforeEach(async () => {
    await db.delete(visitorSaves);
    await db.delete(visitorSessions);
    await db.delete(visitors);
    await db.delete(sites).where(eq(sites.orgId, ORG));
    await db.delete(organizations).where(eq(organizations.id, ORG));

    await db.insert(organizations).values({ id: ORG, name: "Visitors org" });
    await db.insert(sites).values([
      { id: SITE, orgId: ORG, slug: "one", name: "One" },
      { id: OTHER, orgId: ORG, slug: "two", name: "Two" },
    ]);

    here = new VisitorUseCase(db, { orgId: ORG, siteId: SITE });
    elsewhere = new VisitorUseCase(db, { orgId: ORG, siteId: OTHER });
  });

  const register = (use = here) => use.register({ email: EMAIL, password: PASSWORD });

  describe("accounts", () => {
    it("registers and signs in", async () => {
      const created = await register();
      expect(created.visitor.email).toBe(EMAIL);

      const session = await here.signIn({ email: EMAIL, password: PASSWORD });
      expect(session.visitor.id).toBe(created.visitor.id);
    });

    it("answers the same way for a taken address as for a wrong password", async () => {
      // "That address is taken" is a way to ask a site which of your customers
      // it has.
      await register();
      await expect(register()).rejects.toBeInstanceOf(VisitorCredentialsError);
      await expect(here.signIn({ email: EMAIL, password: "wrong" })).rejects.toBeInstanceOf(
        VisitorCredentialsError,
      );
    });

    it("refuses a password nobody would call one", async () => {
      await expect(here.register({ email: "x@y.test", password: "short" })).rejects.toThrow(/10/);
    });

    it("stores a hash, never the password", async () => {
      await register();
      const [row] = await db.select().from(visitors).where(eq(visitors.email, EMAIL));

      expect(row!.passwordHash).not.toContain(PASSWORD);
      expect(row!.passwordHash.startsWith("$argon2id$")).toBe(true);
    });
  });

  describe("separation", () => {
    it("is a different account on a different site", async () => {
      // Two sites of one agency's clients are two businesses; a shared login
      // would surprise both.
      await register(here);
      await expect(elsewhere.signIn({ email: EMAIL, password: PASSWORD })).rejects.toBeInstanceOf(
        VisitorCredentialsError,
      );

      await expect(register(elsewhere)).resolves.toBeTruthy();
    });

    it("does not accept a token minted for another site", async () => {
      const session = await register(here);
      expect(await elsewhere.fromToken(session.token)).toBeNull();
    });

    it("is not an owner, and its token is not an admin session", async () => {
      // The separation the whole ADR rests on: a visitor session must not
      // resolve to an actor, or "saved a hotel" and "edited the site" are one
      // permissions bug apart.
      const session = await register();
      expect(await new AuthenticateUseCase(db).execute(session.token)).toBeNull();
    });

    it("stops working when signed out", async () => {
      const session = await register();
      await here.signOut(session.token);
      expect(await here.fromToken(session.token)).toBeNull();
    });
  });

  describe("saving", () => {
    const ENTRY = "01a07000-0000-7000-8000-000000000001";

    it("keeps an entry once, however many times it is clicked", async () => {
      const { visitor } = await register();
      await here.save(visitor.id, "property", ENTRY);
      await here.save(visitor.id, "property", ENTRY);

      expect(await here.saved(visitor.id)).toEqual([ENTRY]);
    });

    it("forgets one when asked", async () => {
      const { visitor } = await register();
      await here.save(visitor.id, "property", ENTRY);
      await here.unsave(visitor.id, ENTRY);

      expect(await here.saved(visitor.id)).toEqual([]);
    });

    it("keeps one visitor's saves out of another's", async () => {
      const mine = await register();
      const theirs = await here.register({ email: "other@example.test", password: PASSWORD });

      await here.save(mine.visitor.id, "property", ENTRY);
      expect(await here.saved(theirs.visitor.id)).toEqual([]);
    });
  });
});

afterAll(async () => {
  if (url) await closeAllPools();
});
