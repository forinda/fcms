/**
 * A starter, applied the way the button applies it (ADR 0036).
 *
 * The other test proves each starter parses. This one proves it *lands*: the
 * migration planner builds its tables, the spec is stored, the first line of
 * history says which starter it was, and an entry can be written to the type it
 * just declared. Those are four separate ways a starter could be valid on paper
 * and still leave somebody with a broken first afternoon.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  closeAllPools,
  createDb,
  entries,
  organizations,
  siteSpecs,
  sites,
  specPatches,
} from "@forinda-cms/db";
import { SiteSpec } from "@forinda-cms/spec";

import { ApplySpecUseCase } from "@/modules/admin/use-cases/apply-spec.usecase";
import { SiteHistoryUseCase } from "@/modules/admin/use-cases/site-history.usecase";
import { EntryWriteUseCase } from "@/modules/admin/use-cases/entries.usecase";
import { SpecRepository } from "@/shared/repositories";
import { STARTERS, starterFor } from "..";

const url = process.env["DATABASE_URL"];
const suite = url ? describe : describe.skip;
const db = url ? createDb(url) : (undefined as never);

const ORG = "org_starters";
const SITE = "site_starters";
const scope = { orgId: ORG, siteId: SITE };
const ACTOR = { actor: "owner@example.test", role: "owner" as const };

suite("applying a starter", () => {
  beforeEach(async () => {
    await db.delete(specPatches).where(eq(specPatches.orgId, ORG));
    await db.delete(entries).where(eq(entries.orgId, ORG));
    await db.delete(siteSpecs).where(eq(siteSpecs.orgId, ORG));
    await db.delete(sites).where(eq(sites.orgId, ORG));
    await db.delete(organizations).where(eq(organizations.id, ORG));
    await db.insert(organizations).values({ id: ORG, name: "Starter org" });
    await db.insert(sites).values({ id: SITE, orgId: ORG, slug: "starter", name: "A new site" });
  });

  it.each(STARTERS.map((s) => [s.key] as const))("%s applies to an empty site", async (key) => {
    const starter = starterFor(key)!;
    const spec = SiteSpec.parse(starter.build("Riverside Salon"));

    const result = await new ApplySpecUseCase(db, scope).execute(spec, {
      ...ACTOR,
      source: `starter:${key}`,
    });

    expect((await new SpecRepository(db, scope).find())?.name).toBe("Riverside Salon");
    // Entries share one table, so a migration step is an index rather than a
    // column: one per field somebody can filter or sort by, and one per field
    // that has to be unique. The count is a property of the starter, and zero
    // is the right answer for one that declares neither.
    const stored = spec.content.filter((t) => !t.derived).flatMap((t) => t.fields);
    expect(result.migration.length).toBe(
      stored.filter((f) => "filterable" in f && f.filterable).length +
        stored.filter((f) => "unique" in f && f.unique).length,
    );

    const [first] = await new SiteHistoryUseCase(db, scope).execute(1);
    expect(first?.source).toBe(`starter:${key}`);
    expect(first?.actor).toBe("owner@example.test");
  });

  it("leaves a site somebody can immediately use", async () => {
    const spec = SiteSpec.parse(starterFor("bookings")!.build("Riverside Salon"));
    await new ApplySpecUseCase(db, scope).execute(spec, { ...ACTOR, source: "starter:bookings" });

    // The point of a starter is that the next thing you do works. Adding a
    // service is the next thing anyone does.
    const written = await new EntryWriteUseCase(db, scope).create(spec, {
      typeKey: "service",
      slug: "haircut",
      status: "published",
      data: { slug: "haircut", name: "Haircut", price: 1500, minutes: 45, active: true },
    });

    expect(written.ok).toBe(true);
  });
});

afterAll(async () => {
  if (url) await closeAllPools();
});
