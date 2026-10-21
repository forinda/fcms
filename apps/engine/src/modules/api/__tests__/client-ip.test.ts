/**
 * Who a sign-in came from, behind a reverse proxy.
 *
 * The lockout counts failures per address as well as per email, so the
 * address has to be the visitor's. Two ways it was not:
 *
 * - Behind a proxy every request arrived from the proxy, so ten bad sign-ins
 *   from anyone locked out everyone — `X-Forwarded-For` was read only after
 *   `req.ip`, which is always set.
 * - Where it was read, it was the *first* hop: the one a client writes
 *   itself. A guesser could name a fresh address on every attempt, or name
 *   somebody else's and lock them out.
 *
 * With one trusted hop, the address is the one the proxy appended.
 */
import "@/config";

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expressRuntime } from "@forinda/kickjs";
import { createTestApp } from "@forinda/kickjs-testing";
import { closeAllPools, createDb, type Db } from "@forinda-cms/db";

import { DatabaseAdapter } from "@/adapters/database.adapter";
import { trustProxy } from "@/config";
import { middlewares } from "@/middleware";
import { ApiModule } from "@/modules/api/api.module";
import { hashPassword } from "@/shared/auth/passwords";
import { OwnerRepository } from "@/shared/repositories/owner.repository";
import { standalone } from "@/shared/standalone";

const url = process.env["DATABASE_URL"];
const suite = url ? describe : describe.skip;
const scope = {
  orgId: process.env["ORG_ID"] ?? "default",
  siteId: process.env["SITE_ID"] ?? "default",
};
const EMAIL = "owner@client-ip.test";
const PASSWORD = "a-long-enough-password";

suite("the address a sign-in is recorded from", () => {
  let db: Db;

  beforeAll(async () => {
    db = createDb(url!);
    await db.deleteFrom("login_attempts").execute();
    await db.deleteFrom("owner_sessions").execute();
    await db.deleteFrom("owners").execute();
    await db
      .insertInto("organizations")
      .values({ id: scope.orgId, name: "Client IP" })
      .onConflict((oc) => oc.doNothing())
      .execute();
    await standalone(db)(OwnerRepository).create({
      orgId: scope.orgId,
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD),
    });
  });

  afterAll(async () => {
    if (url) await closeAllPools();
  });

  const signInBehind = async (behindProxy: boolean) => {
    const { app } = await createTestApp({
      modules: [ApiModule()],
      adapters: [DatabaseAdapter({ migrate: false })],
      middlewares,
      runtime: expressRuntime(),
      apiPrefix: "",
      defaultVersion: false,
      trustProxy: trustProxy(behindProxy),
    });
    const res = await request(app.handle.bind(app))
      .post("/api/login")
      // The first hop is whatever the client wrote; the last is what the
      // proxy appended — the address it actually saw.
      .set("x-forwarded-for", "198.51.100.7, 203.0.113.9")
      .send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    const row = await db
      .selectFrom("owner_sessions")
      .select("ipAddress")
      .orderBy("createdAt", "desc")
      .executeTakeFirstOrThrow();
    return row.ipAddress;
  };

  it("is the address the proxy saw, not the proxy, and not the one the client wrote", async () => {
    expect(await signInBehind(true)).toBe("203.0.113.9");
  });

  it("ignores the header entirely when nothing says a proxy is there", async () => {
    // Without TRUST_PROXY anyone can send the header, so it means nothing.
    const recorded = await signInBehind(false);
    expect(recorded).not.toBe("203.0.113.9");
    expect(recorded).not.toBe("198.51.100.7");
  });
});
