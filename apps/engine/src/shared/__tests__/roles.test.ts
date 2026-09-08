/**
 * What a role may propose (ADR 0041, implementing ADR 0008 §2).
 *
 * The check lives at the apply, so this is where every door — the admin, the
 * CLI, MCP, the assistant — is governed. A test per screen would test the
 * screens; this tests the rule.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  closeAllPools,
  createDb,
  organizations,
  siteSpecs,
  sites,
  specPatches,
} from "@forinda-cms/db";
import { SiteSpec } from "@forinda-cms/spec";

import { ApplySpecUseCase, NotAllowedError } from "@/modules/admin/use-cases/apply-spec.usecase";
import { atLeast, refusal, roleOf, ROLES } from "@/shared/roles";

const url = process.env["DATABASE_URL"];
const suite = url ? describe : describe.skip;
const db = url ? createDb(url) : (undefined as never);

const ORG = "org_roles";
const SITE = "site_roles";
const scope = { orgId: ORG, siteId: SITE };

const spec = SiteSpec.parse({
  specVersion: 2,
  name: "Riverside Salon",
  theme: { colors: { brand: "#1a7f5a" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
  content: [
    { key: "service", label: "Service", fields: [{ name: "name", label: "Name", type: "text" }] },
  ],
  pages: [
    { key: "home", path: "/", title: "Home", blocks: [{ type: "heading", attrs: { text: "Hi" } }] },
  ],
  logic: [],
});

describe("the ladder", () => {
  it("is ordered, and an unknown role is the bottom of it", () => {
    expect(atLeast("owner", "developer")).toBe(true);
    expect(atLeast("editor", "manager")).toBe(false);
    // A role nobody recognises must not be treated as one that can do anything.
    expect(roleOf("root")).toBe("viewer");
    expect(atLeast("root", "editor")).toBe(false);
    expect(atLeast(undefined, "viewer")).toBe(true);
  });

  it("names the role and the thing in its refusal", () => {
    // "Ask whoever runs this site" is the next step, and it is in the sentence.
    expect(refusal("editor", "change how the site is put together")).toContain(
      "Entries and pictures",
    );
    expect(refusal("editor", "change how the site is put together")).toContain("Ask whoever runs");
  });

  it("keeps ADR 0008's taxonomy rather than inventing one", () => {
    expect([...ROLES]).toEqual(["viewer", "editor", "manager", "designer", "developer", "owner"]);
  });
});

suite("applying a spec", () => {
  beforeEach(async () => {
    await db.delete(specPatches).where(eq(specPatches.orgId, ORG));
    await db.delete(siteSpecs).where(eq(siteSpecs.orgId, ORG));
    await db.delete(sites).where(eq(sites.orgId, ORG));
    await db.delete(organizations).where(eq(organizations.id, ORG));
    await db.insert(organizations).values({ id: ORG, name: "Roles org" });
    await db.insert(sites).values({ id: SITE, orgId: ORG, slug: "roles", name: "Roles" });
  });

  const apply = (role: string, next = spec) =>
    new ApplySpecUseCase(db, scope).execute(next, {
      actor: "someone@example.test",
      role: role as never,
      source: "admin",
    });

  it("lets a manager change how the site is put together", async () => {
    await expect(apply("manager")).resolves.toMatchObject({ seq: 1 });
  });

  it("refuses an editor, who edits entries rather than the site", async () => {
    await expect(apply("editor")).rejects.toBeInstanceOf(NotAllowedError);
    // And nothing was written: a refused apply is not a half-applied one.
    expect(await db.select().from(siteSpecs).where(eq(siteSpecs.orgId, ORG))).toHaveLength(0);
  });

  it("refuses a viewer", async () => {
    await expect(apply("viewer")).rejects.toBeInstanceOf(NotAllowedError);
  });

  it("refuses a role it does not recognise", async () => {
    // A caller inventing `role: "admin"` gets the bottom of the ladder.
    await expect(apply("admin")).rejects.toBeInstanceOf(NotAllowedError);
  });

  describe("custom CSS", () => {
    const withCss = SiteSpec.parse({ ...spec, css: ".fx-section { outline: 1px solid red }" });
    const withBlockCss = SiteSpec.parse({
      ...spec,
      pages: [
        {
          ...spec.pages[0]!,
          blocks: [{ type: "heading", attrs: { text: "Hi" }, css: "color:red" }],
        },
      ],
    });

    it("is the developer's, at the site level", async () => {
      await apply("manager");
      await expect(apply("manager", withCss)).rejects.toThrow(/custom CSS/);
      await expect(apply("developer", withCss)).resolves.toMatchObject({ seq: 2 });
    });

    it("is the developer's on a block too", async () => {
      // Tier 3 hidden one level down is still tier 3 (ADR 0004).
      await apply("manager");
      await expect(apply("manager", withBlockCss)).rejects.toThrow(/custom CSS/);
    });

    it("does not stand in the way of a change that leaves it alone", async () => {
      await apply("developer", withCss);
      const renamed = SiteSpec.parse({ ...withCss, name: "Riverside" });
      await expect(apply("manager", renamed)).resolves.toMatchObject({ seq: 2 });
    });
  });
});

afterAll(async () => {
  if (url) await closeAllPools();
});
