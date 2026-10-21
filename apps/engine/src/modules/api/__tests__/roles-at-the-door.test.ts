/**
 * A role is checked at the write, whichever door the write came through.
 *
 * The admin checked before writing an entry; `/api` did not, so a viewer — or
 * a terminal or agent holding a viewer's token (ADR 0015 §4) — could create,
 * change and delete content, and undo a developer's CSS. These drive the real
 * routes with real tokens, because "the use-case refuses" is only the property
 * if every route reaches the use-case.
 */
import "@/config";

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expressRuntime } from "@forinda/kickjs";
import { createTestApp } from "@forinda/kickjs-testing";
import { closeAllPools, createDb, type Db } from "@forinda-cms/db";
import { SiteSpec } from "@forinda-cms/spec";

import { DatabaseAdapter } from "@/adapters/database.adapter";
import { middlewares } from "@/middleware";
import { ApiModule } from "@/modules/api/api.module";
import { ApplySpecUseCase } from "@/modules/admin/use-cases/apply-spec.usecase";
import { LoginUseCase } from "@/shared/auth/auth.usecase";
import { hashPassword } from "@/shared/auth/passwords";
import { OwnerRepository } from "@/shared/repositories/owner.repository";
import { standalone } from "@/shared/standalone";

const url = process.env["DATABASE_URL"];
const suite = url ? describe : describe.skip;

// The site the app resolves to with no domain configured: `ORG_ID`/`SITE_ID`.
const scope = {
  orgId: process.env["ORG_ID"] ?? "default",
  siteId: process.env["SITE_ID"] ?? "default",
};
const PASSWORD = "a-long-enough-password";

const spec = (css?: string) =>
  SiteSpec.parse({
    specVersion: 2,
    name: "Doors",
    ...(css === undefined ? {} : { css }),
    theme: { colors: { brand: "#1a7f5a" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
    content: [
      { key: "service", label: "Service", fields: [{ name: "name", label: "Name", type: "text" }] },
    ],
    pages: [
      {
        key: "home",
        path: "/",
        title: "Home",
        blocks: [{ type: "heading", attrs: { text: "Hi" } }],
      },
    ],
    logic: [],
  });

suite("roles at the door", () => {
  let db: Db;
  let http: ReturnType<typeof request>;
  const tokens: Record<string, string> = {};
  let entryId: string;

  beforeAll(async () => {
    db = createDb(url!);
    await db.deleteFrom("owner_sessions").execute();
    await db.deleteFrom("owners").execute();
    await db.deleteFrom("sites").where("id", "=", scope.siteId).execute();
    await db.deleteFrom("organizations").where("id", "=", scope.orgId).execute();
    await db.insertInto("organizations").values({ id: scope.orgId, name: "Doors" }).execute();
    await db
      .insertInto("sites")
      .values({ id: scope.siteId, orgId: scope.orgId, slug: "doors", name: "Doors" })
      .execute();

    const get = standalone(db, scope);
    await get(ApplySpecUseCase).execute(spec(), { actor: "test", role: "owner", source: "cli" });
    // A developer's CSS, for undo to try to take away.
    await get(ApplySpecUseCase).execute(spec("body { color: teal }"), {
      actor: "test",
      role: "developer",
      source: "cli",
    });

    const owners = get(OwnerRepository);
    for (const role of ["viewer", "editor"]) {
      const email = `${role}@doors.test`;
      await owners.create({
        orgId: scope.orgId,
        email,
        role,
        passwordHash: await hashPassword(PASSWORD),
      });
      tokens[role] = (await get(LoginUseCase).execute({ email, password: PASSWORD })).token;
    }

    const entry = await db
      .insertInto("entries")
      .values({ ...scope, typeKey: "service", slug: "cut", data: { name: "Cut" }, status: "draft" })
      .returningAll()
      .executeTakeFirstOrThrow();
    entryId = entry.id;

    const { app } = await createTestApp({
      modules: [ApiModule()],
      adapters: [DatabaseAdapter({ migrate: false })],
      middlewares,
      runtime: expressRuntime(),
      apiPrefix: "",
      defaultVersion: false,
    });
    http = request(app.handle.bind(app));
  });

  afterAll(async () => {
    if (url) await closeAllPools();
  });

  const as = (role: string) => ({ authorization: `Bearer ${tokens[role]}` });
  const count = async () =>
    (await db.selectFrom("entries").select("id").where("siteId", "=", scope.siteId).execute())
      .length;

  describe("a viewer", () => {
    it("cannot create an entry", async () => {
      const before = await count();
      const res = await http
        .post("/api/entries/service")
        .set(as("viewer"))
        .send({ data: { name: "Sneaky" } });
      expect(res.status).toBe(403);
      expect(await count()).toBe(before);
    });

    it("cannot change one", async () => {
      const res = await http
        .patch(`/api/entries/service/${entryId}`)
        .set(as("viewer"))
        .send({ data: { name: "Changed" } });
      expect(res.status).toBe(403);
      const row = await db
        .selectFrom("entries")
        .select("data")
        .where("id", "=", entryId)
        .executeTakeFirst();
      expect(row?.data).toEqual({ name: "Cut" });
    });

    it("cannot delete one", async () => {
      const res = await http.delete(`/api/entries/service/${entryId}`).set(as("viewer"));
      expect(res.status).toBe(403);
      expect(await count()).toBeGreaterThan(0);
    });

    it("cannot undo the site, and the developer's CSS stays", async () => {
      const res = await http.post("/api/undo").set(as("viewer"));
      expect(res.status).toBe(403);
      const row = await db
        .selectFrom("site_specs")
        .select("document")
        .where("siteId", "=", scope.siteId)
        .executeTakeFirst();
      expect(row?.document.css).toBe("body { color: teal }");
    });

    it("is refused a spec change with a 403, not a server error", async () => {
      const res = await http.post("/api/apply").set(as("viewer")).send({ spec: spec() });
      expect(res.status).toBe(403);
    });
  });

  describe("an editor", () => {
    // The control: the same routes do work for somebody allowed to use them,
    // so a 403 above is the role and not a broken route.
    it("creates and changes entries", async () => {
      const created = await http
        .post("/api/entries/service")
        .set(as("editor"))
        .send({ data: { name: "Trim" } });
      expect(created.status).toBe(200);

      const changed = await http
        .patch(`/api/entries/service/${created.body.entry.id}`)
        .set(as("editor"))
        .send({ data: { name: "Trim, short" } });
      expect(changed.status).toBe(200);
    });

    it("cannot undo the site either", async () => {
      // Undo is a spec change, held to what applying the restored document
      // would need (ADR 0008 §2) — and an editor edits entries, not the site.
      const res = await http.post("/api/undo").set(as("editor"));
      expect(res.status).toBe(403);
    });
  });
});
