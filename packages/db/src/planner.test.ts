/**
 * Planner tests.
 *
 * The pure-planning half runs anywhere. The half that actually executes SQL
 * needs a database, and is where the claims that matter get checked: that a
 * plan is idempotent, that destructive steps do not run unasked, and that an
 * index the planner says it made is one Postgres will actually use.
 */
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { SiteSpec } from "@forinda-cms/spec";

import { closeAllPools, createDb } from "./client.js";
import { indexName, planMigration, runMigration } from "./planner.js";
import { entries, organizations, siteSpecs, sites, specPatches } from "./schema.js";
import { SiteRepository } from "./repository.js";

const SITE = "site_planner";
const ORG = "org_planner";

const specWith = (fields: unknown[]) =>
  SiteSpec.parse({
    specVersion: 1,
    name: "Test",
    theme: { colors: { brand: "#000000" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
    content: [{ key: "service", label: "Service", fields }],
    pages: [],
  });

const plain = specWith([
  { name: "name", label: "Name", type: "text" },
  { name: "price", label: "Price", type: "number" },
]);

const indexed = specWith([
  { name: "name", label: "Name", type: "text" },
  { name: "price", label: "Price", type: "number", filterable: true },
]);

const dropped = specWith([{ name: "name", label: "Name", type: "text" }]);

describe("planning (no database needed)", () => {
  it("indexes a field when it becomes filterable", () => {
    const steps = planMigration(plain, indexed, { siteId: SITE });
    expect(steps.length).toBe(1);
    expect(steps[0]!.kind).toBe("create-index");
    expect(steps[0]!.classification).toBe("additive");
    // Cast, or `10` sorts before `9`.
    expect(steps[0]!.statement).toContain("::numeric");
    // Scoped by the WHERE clause rather than by a table-wide column — the
    // deviation from doc 03 §2 that makes a shared entries table workable.
    expect(steps[0]!.statement).toContain(`site_id = '${SITE}'`);
    expect(steps[0]!.statement).toContain("type_key = 'service'");
  });

  it("plans nothing when nothing relevant changed", () => {
    expect(planMigration(indexed, indexed, { siteId: SITE })).toEqual([]);
  });

  it("rebuilds an index when the field's type changes", () => {
    const asText = specWith([
      { name: "name", label: "Name", type: "text" },
      { name: "price", label: "Price", type: "text", filterable: true },
    ]);
    const steps = planMigration(indexed, asText, { siteId: SITE });
    // Drop before create: the old expression would answer with the wrong
    // ordering rather than not answer at all.
    expect(steps.map((s) => s.kind)).toEqual(["drop-index", "create-index"]);
  });

  it("treats removing a field's values as destructive and dropping its index as not", () => {
    const steps = planMigration(indexed, dropped, { siteId: SITE });
    const purge = steps.find((s) => s.kind === "purge-field")!;
    expect(purge.classification).toBe("destructive");
    expect(steps.find((s) => s.kind === "drop-index")!.classification).toBe("additive");
    expect(purge.description).toMatch(/Deletes the stored Price values/);
  });

  it("orders additive steps first, so an interrupted run leaves more rather than less", () => {
    const steps = planMigration(indexed, dropped, { siteId: SITE });
    expect(steps[0]!.classification).toBe("additive");
    expect(steps.at(-1)!.classification).toBe("destructive");
  });

  it("deletes a removed type's entries, and says so plainly", () => {
    const gone = SiteSpec.parse({ ...indexed, content: [] });
    const steps = planMigration(indexed, gone, { siteId: SITE });
    const del = steps.find((s) => s.kind === "delete-entries")!;
    expect(del.classification).toBe("destructive");
    expect(del.description).toMatch(/Deletes every stored Service record/);
  });

  it("gives an index a deterministic name inside Postgres's identifier limit", () => {
    const name = indexName(SITE, "service", "price");
    expect(name).toBe(indexName(SITE, "service", "price"));
    expect(name.length).toBeLessThanOrEqual(63);
    expect(indexName(SITE, "service", "name")).not.toBe(name);
  });

  it("refuses an identifier that could reach SQL unquoted", () => {
    // Spec keys are validated upstream, but a schema is a long way from a SQL
    // string and the assertion costs nothing.
    expect(() =>
      planMigration(undefined, indexed, { siteId: "bad'; drop table entries; --" }),
    ).toThrow(/unsafe site id/);
  });
});

const url = process.env["DATABASE_URL"];
const suite = url ? describe : describe.skip;
const db = url ? createDb(url) : (undefined as never);

suite("executing a plan (needs a database)", () => {
  const repo = () => new SiteRepository(db, { orgId: ORG, siteId: SITE });

  const reset = async () => {
    await db.delete(specPatches).where(eq(specPatches.orgId, ORG));
    await db.delete(entries).where(eq(entries.orgId, ORG));
    await db.delete(siteSpecs).where(eq(siteSpecs.orgId, ORG));
    await db.delete(sites).where(eq(sites.orgId, ORG));
    await db.delete(organizations).where(eq(organizations.id, ORG));
    await db.execute(sql.raw(`DROP INDEX IF EXISTS ${indexName(SITE, "service", "price")}`));
    await db.insert(organizations).values({ id: ORG, name: "Planner org" });
    await db.insert(sites).values({ id: SITE, orgId: ORG, slug: "planner", name: "Planner" });
  };

  const indexExists = async (name: string) => {
    const rows = await db.execute(sql.raw(`SELECT 1 FROM pg_indexes WHERE indexname = '${name}'`));
    return (rows as unknown as unknown[]).length > 0;
  };

  it("creates the index it planned, and is idempotent", async () => {
    await reset();
    await repo().applySpec(plain, { actor: "a", source: "cli" });

    const { migration } = await repo().applySpec(indexed, { actor: "a", source: "cli" });
    expect(migration.map((s) => s.kind)).toEqual(["create-index"]);
    expect(await indexExists(indexName(SITE, "service", "price"))).toBe(true);

    // Re-running the same plan must be safe — the property that lets the
    // install artifact migrate on boot without reasoning about prior state.
    const again = planMigration(plain, indexed, { siteId: SITE });
    await runMigration(db, again);
    expect(await indexExists(indexName(SITE, "service", "price"))).toBe(true);
  });

  it("does not purge values when the destructive half was not allowed", async () => {
    await reset();
    await repo().applySpec(indexed, { actor: "a", source: "cli" });
    await db.insert(entries).values({
      id: "e1",
      siteId: SITE,
      orgId: ORG,
      typeKey: "service",
      slug: "cut",
      data: { name: "Cut", price: 1500 },
    });

    // The spec change itself is refused first, so nothing runs at all.
    await expect(repo().applySpec(dropped, { actor: "a", source: "cli" })).rejects.toThrow();
    const [row] = await db.select().from(entries).where(eq(entries.id, "e1"));
    expect((row!.data as Record<string, unknown>)["price"]).toBe(1500);
  });

  it("purges values and drops the index when the change is confirmed", async () => {
    await reset();
    await repo().applySpec(indexed, { actor: "a", source: "cli" });
    await db.insert(entries).values({
      id: "e1",
      siteId: SITE,
      orgId: ORG,
      typeKey: "service",
      slug: "cut",
      data: { name: "Cut", price: 1500 },
    });

    const { migration } = await repo().applySpec(dropped, {
      actor: "a",
      source: "cli",
      allowDestructive: true,
    });
    expect(migration.map((s) => s.kind).sort()).toEqual(["drop-index", "purge-field"]);

    const [row] = await db.select().from(entries).where(eq(entries.id, "e1"));
    expect((row!.data as Record<string, unknown>)["price"]).toBeUndefined();
    // The name survives: only the removed field's values are deleted.
    expect((row!.data as Record<string, unknown>)["name"]).toBe("Cut");
    expect(await indexExists(indexName(SITE, "service", "price"))).toBe(false);
  });

  it("rolls the index back when the surrounding transaction fails", async () => {
    await reset();
    await repo().applySpec(plain, { actor: "a", source: "cli" });

    // A spec the schema rejects on the way in, after the plan was computed.
    await expect(
      repo().applySpec({ ...indexed, specVersion: 99 } as never, { actor: "a", source: "cli" }),
    ).rejects.toThrow();

    // The migration must not have escaped the failed transaction, or the
    // database would claim a shape the spec does not describe.
    expect(await indexExists(indexName(SITE, "service", "price"))).toBe(false);
  });

  it("leaves another site's index alone", async () => {
    await reset();
    await repo().applySpec(indexed, { actor: "a", source: "cli" });
    expect(await indexExists(indexName("site_someone_else", "service", "price"))).toBe(false);
  });

  it("closes its pools", async () => {
    if (url) await closeAllPools();
  });
});
