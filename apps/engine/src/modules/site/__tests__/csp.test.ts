/**
 * The site's Content-Security-Policy, as a browser receives it.
 *
 * The policy only protects if three things agree: the header names a nonce,
 * every script and style the page carries has that nonce, and the nonce is
 * new on every response — one an attacker can read off yesterday's page is a
 * nonce in name only.
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
import { SiteModule } from "@/modules/site/site.module";
import { ApplySpecUseCase } from "@/modules/admin/use-cases/apply-spec.usecase";
import { standalone } from "@/shared/standalone";

const url = process.env["DATABASE_URL"];
const suite = url ? describe : describe.skip;
const scope = {
  orgId: process.env["ORG_ID"] ?? "default",
  siteId: process.env["SITE_ID"] ?? "default",
};

const spec = SiteSpec.parse({
  specVersion: 2,
  name: "Policy",
  theme: { colors: { brand: "#1a7f5a" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
  analytics: { gtag: "G-ABC1234567" },
  content: [],
  pages: [
    {
      key: "home",
      path: "/",
      title: "Home",
      blocks: [{ type: "richtext", attrs: { html: "<p>Hello</p><script>alert(1)</script>" } }],
    },
  ],
  logic: [],
});

const policyNonce = (header: string | undefined) => /'nonce-([^']+)'/.exec(header ?? "")?.[1];
const tags = (html: string) =>
  [...html.matchAll(/<(script|style)\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => !tag.includes("application/ld+json"));

suite("the site's content security policy", () => {
  let db: Db;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    db = createDb(url!);
    await db.deleteFrom("sites").where("id", "=", scope.siteId).execute();
    await db.deleteFrom("organizations").where("id", "=", scope.orgId).execute();
    await db.insertInto("organizations").values({ id: scope.orgId, name: "Policy" }).execute();
    await db
      .insertInto("sites")
      .values({ id: scope.siteId, orgId: scope.orgId, slug: "policy", name: "Policy" })
      .execute();
    await standalone(
      db,
      scope,
    )(ApplySpecUseCase).execute(spec, {
      actor: "test",
      role: "owner",
      source: "cli",
    });

    const { app } = await createTestApp({
      modules: [SiteModule()],
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

  it("names a nonce that every script and style on the page carries", async () => {
    const res = await http.get("/");
    expect(res.status).toBe(200);

    const header = res.headers["content-security-policy"] as string | undefined;
    const nonce = policyNonce(header);
    expect(nonce).toBeTruthy();
    expect(header).toContain("'strict-dynamic'");
    expect(header).toContain("object-src 'none'");
    expect(header).toContain("frame-ancestors 'self'");

    const found = tags(res.text);
    expect(found.length).toBeGreaterThanOrEqual(3); // site CSS, gtag loader, gtag init
    for (const tag of found) expect(tag).toContain(`nonce="${nonce}"`);
  });

  it("is a new nonce on every response", async () => {
    const [a, b] = await Promise.all([http.get("/"), http.get("/")]);
    expect(policyNonce(a.headers["content-security-policy"])).not.toBe(
      policyNonce(b.headers["content-security-policy"]),
    );
  });

  it("covers the not-found page too", async () => {
    const res = await http.get("/no-such-page");
    expect(res.status).toBe(404);
    const nonce = policyNonce(res.headers["content-security-policy"]);
    expect(nonce).toBeTruthy();
    for (const tag of tags(res.text)) expect(tag).toContain(`nonce="${nonce}"`);
  });
});
