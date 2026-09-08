/**
 * The query behind the admin's list (ADR 0037).
 *
 * The screen used to read every row of a type in whatever order Postgres
 * returned them. Three things were wrong with that and each has a case here:
 * the order was not stable, there was no way to find one row, and the page grew
 * without limit.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeAllPools, createDb, entries, organizations, sites } from "@forinda-cms/db";

import { EntryRepository } from "@/shared/repositories";

const url = process.env["DATABASE_URL"];
const suite = url ? describe : describe.skip;
const db = url ? createDb(url) : (undefined as never);

const ORG = "org_list";
const SITE = "site_list";
const scope = { orgId: ORG, siteId: SITE };

const at = (day: number) => new Date(Date.UTC(2026, 0, day, 9, 0, 0));

suite("a page of entries", () => {
  let repo: EntryRepository;

  beforeEach(async () => {
    await db.delete(entries).where(eq(entries.orgId, ORG));
    await db.delete(sites).where(eq(sites.orgId, ORG));
    await db.delete(organizations).where(eq(organizations.id, ORG));
    await db.insert(organizations).values({ id: ORG, name: "List org" });
    await db.insert(sites).values({ id: SITE, orgId: ORG, slug: "list", name: "List" });

    await db.insert(entries).values([
      {
        siteId: SITE,
        orgId: ORG,
        typeKey: "booking",
        slug: "ana",
        status: "published",
        data: { customerName: "Ana Mwangi", phone: "0700000001" },
        createdAt: at(1),
        updatedAt: at(9),
      },
      {
        siteId: SITE,
        orgId: ORG,
        typeKey: "booking",
        slug: "ben",
        status: "draft",
        data: { customerName: "Ben Otieno", phone: "0700000002" },
        createdAt: at(2),
        updatedAt: at(2),
      },
      {
        siteId: SITE,
        orgId: ORG,
        typeKey: "booking",
        slug: "carol",
        status: "published",
        data: { customerName: "Carol Wanjiru", phone: "0700000003" },
        createdAt: at(3),
        updatedAt: at(3),
      },
      // Another type, to prove the filter is not "everything on the site".
      {
        siteId: SITE,
        orgId: ORG,
        typeKey: "service",
        slug: "haircut",
        status: "published",
        data: { name: "Haircut" },
        createdAt: at(4),
        updatedAt: at(4),
      },
    ]);

    repo = new EntryRepository(db, scope);
  });

  const page = (over: Record<string, unknown> = {}) =>
    repo.pageOfType("booking", {
      limit: 25,
      offset: 0,
      titleField: "customerName",
      searchable: ["customerName", "phone"],
      ...over,
    });

  it("is newest first, and the same order twice", async () => {
    const first = await page();
    const second = await page();
    expect(first.rows.map((r) => r.slug)).toEqual(["carol", "ben", "ana"]);
    expect(second.rows.map((r) => r.slug)).toEqual(first.rows.map((r) => r.slug));
    expect(first.total).toBe(3);
  });

  it("orders by name, by age and by when it was last touched", async () => {
    expect((await page({ sort: "title" })).rows.map((r) => r.slug)).toEqual([
      "ana",
      "ben",
      "carol",
    ]);
    expect((await page({ sort: "oldest" })).rows.map((r) => r.slug)).toEqual([
      "ana",
      "ben",
      "carol",
    ]);
    // Ana was created first and changed last.
    expect((await page({ sort: "updated" })).rows[0]?.slug).toBe("ana");
  });

  it("finds a row by what is in it, not only by its slug", async () => {
    expect((await page({ search: "wanjiru" })).rows.map((r) => r.slug)).toEqual(["carol"]);
    expect((await page({ search: "0700000002" })).rows.map((r) => r.slug)).toEqual(["ben"]);
    expect((await page({ search: "ana" })).rows.map((r) => r.slug)).toEqual(["ana"]);
  });

  it("treats a wildcard as text, because someone will type one", async () => {
    // `%` unescaped matches every row, which does not look like a broken
    // search — it looks like one that worked.
    expect((await page({ search: "%" })).total).toBe(0);
    expect((await page({ search: "_" })).total).toBe(0);
    // …and a name that really contains one is still findable.
    await db.insert(entries).values({
      siteId: SITE,
      orgId: ORG,
      typeKey: "booking",
      slug: "percent",
      status: "draft",
      data: { customerName: "50% off promo" },
      createdAt: at(5),
      updatedAt: at(5),
    });
    expect((await page({ search: "50%" })).rows.map((r) => r.slug)).toEqual(["percent"]);
  });

  it("filters by whether the public can see it", async () => {
    expect((await page({ status: "draft" })).rows.map((r) => r.slug)).toEqual(["ben"]);
    expect((await page({ status: "published" })).total).toBe(2);
  });

  it("counts what matched, not what was returned", async () => {
    const first = await page({ limit: 2, offset: 0 });
    const second = await page({ limit: 2, offset: 2 });

    expect(first.rows).toHaveLength(2);
    expect(second.rows).toHaveLength(1);
    // The pager needs the total to say "1–2 of 3" rather than "1–2 of 2".
    expect(first.total).toBe(3);
    expect(second.total).toBe(3);
    expect([...first.rows, ...second.rows].map((r) => r.slug)).toEqual(["carol", "ben", "ana"]);
  });

  it("never leaves its own type", async () => {
    expect((await page({ search: "haircut" })).total).toBe(0);
  });
});

afterAll(async () => {
  if (url) await closeAllPools();
});
