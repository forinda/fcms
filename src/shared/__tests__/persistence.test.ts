/**
 * Integration tests, against a real Postgres.
 *
 * These test the guarantees the dossier rests on rather than the ORM: that undo
 * is a table lookup (doc 13), that destructive changes are gated by default
 * (doc 03), and that nothing crosses a site boundary (ADR 0002 seam 1). Each of
 * those is an argument in the research made real by a few lines here, and each
 * would be quietly untrue if this file did not exist.
 *
 * Skipped when DATABASE_URL is unset, so `pnpm verify` still runs on a machine
 * with no database — the same reasoning as the eval harness replaying by
 * default: a suite that cannot run is a suite nobody runs.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { SiteSpec } from "@forinda-cms/spec";
import { renderPage, routes } from "@forinda-cms/render";

import {
  closeAllPools,
  createDb,
  entries,
  organizations,
  siteSpecs,
  sites,
  specPatches,
} from "@forinda-cms/db";
import { EntryRepository, SpecRepository } from "@/shared/repositories";
import { EntryReadUseCase } from "@/shared/use-cases";
import {
  ApplySpecUseCase,
  DestructiveChangeError,
} from "@/modules/admin/use-cases/apply-spec.usecase";
import { SiteHistoryUseCase } from "@/modules/admin/use-cases/site-history.usecase";
import { UndoSpecUseCase } from "@/modules/admin/use-cases/undo-spec.usecase";

const url = process.env["DATABASE_URL"];
const suite = url ? describe : describe.skip;

const db = url ? createDb(url) : (undefined as never);

const ORG = "org_test";
const SITE = "site_test";
const OTHER_SITE = "site_other";

const spec = SiteSpec.parse({
  specVersion: 1,
  name: "Riverside Salon",
  theme: { colors: { brand: "#1a7f5a" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
  content: [
    {
      key: "service",
      label: "Service",
      titleField: "name",
      fields: [
        { name: "slug", label: "Slug", type: "text", required: true },
        { name: "name", label: "Name", type: "text", required: true },
        { name: "blurb", label: "Blurb", type: "text" },
      ],
    },
  ],
  pages: [
    {
      key: "home",
      path: "/",
      title: "Home",
      blocks: [
        {
          type: "list",
          data: { from: "service", limit: 10 },
          item: [{ type: "card", attrs: { heading: "{{ item.name }}" } }],
        },
      ],
    },
  ],
});

/** The same spec with the optional field removed — a destructive change. */
const withoutBlurb = SiteSpec.parse({
  ...spec,
  content: [
    { ...spec.content[0]!, fields: spec.content[0]!.fields.filter((f) => f.name !== "blurb") },
  ],
});

suite("the persistence layer", () => {
  /**
   * The use-cases for one site, constructed the way the container constructs
   * them. There is no facade any more — each of these is resolved on its own in
   * a request — so the harness composes exactly what a test needs.
   */
  const of = (siteId = SITE, orgId = ORG) => {
    const scope = { orgId, siteId };
    return {
      apply: new ApplySpecUseCase(db, scope),
      undo: new UndoSpecUseCase(db, scope),
      history: new SiteHistoryUseCase(db, scope),
      specs: new SpecRepository(db, scope),
      entries: new EntryRepository(db, scope),
      read: new EntryReadUseCase(new EntryRepository(db, scope)),
    };
  };
  const repo = of;

  beforeEach(async () => {
    await db.delete(specPatches).where(eq(specPatches.orgId, ORG));
    await db.delete(entries).where(eq(entries.orgId, ORG));
    await db.delete(siteSpecs).where(eq(siteSpecs.orgId, ORG));
    await db.delete(sites).where(eq(sites.orgId, ORG));
    await db.delete(organizations).where(eq(organizations.id, ORG));

    await db.insert(organizations).values({ id: ORG, name: "Test org" });
    await db.insert(sites).values([
      { id: SITE, orgId: ORG, slug: "salon", name: "Riverside Salon" },
      { id: OTHER_SITE, orgId: ORG, slug: "other", name: "Other Salon" },
    ]);
  });

  afterAll(async () => {
    if (url) await closeAllPools();
  });

  describe("the patch spine (doc 03)", () => {
    it("stores a spec and reads it back parsed, not cast", async () => {
      await repo().apply.execute(spec, { actor: "test", source: "cli" });
      const loaded = await repo().specs.find();
      // Parsed on the way out, so a document written by an older version cannot
      // reach the renderer unvalidated.
      expect(loaded).toEqual(spec);
    });

    it("records an inverse for every change, never null", async () => {
      await repo().apply.execute(spec, { actor: "test", source: "cli" });
      const [patch] = await db.select().from(specPatches).where(eq(specPatches.siteId, SITE));
      expect(patch!.inverse).toBeTruthy();
      // Doc 13's argument that a non-developer can review rests on a wrong "yes"
      // being cheap, which is only true because this is written at the time.
      expect(Array.isArray(patch!.inverse)).toBe(true);
    });

    it("numbers patches per site, monotonically", async () => {
      await repo().apply.execute(spec, { actor: "a", source: "cli" });
      await repo().apply.execute({ ...spec, name: "Renamed" }, { actor: "b", source: "chat" });
      const history = await repo().history.execute();
      expect(history.map((h) => h.seq)).toEqual([2, 1]);
      expect(history[0]!.source).toBe("chat");
    });

    it("undoes the last change and leaves the history intact", async () => {
      await repo().apply.execute(spec, { actor: "a", source: "cli" });
      await repo().apply.execute({ ...spec, name: "Renamed" }, { actor: "b", source: "chat" });
      expect((await repo().specs.find())!.name).toBe("Renamed");

      const undone = await repo().undo.execute();
      expect(undone!.seq).toBe(2);
      expect((await repo().specs.find())!.name).toBe("Riverside Salon");

      // Append-only: "what happened to my site last Tuesday" survives an undo.
      const history = await repo().history.execute();
      expect(history.length).toBe(2);
      expect(history[0]!.revertedAt).not.toBeNull();
    });

    it("undoes back to nothing when the first patch is reverted", async () => {
      await repo().apply.execute(spec, { actor: "a", source: "cli" });
      await repo().undo.execute();
      expect(await repo().specs.find()).toBeNull();
    });
  });

  describe("the destructive gate", () => {
    it("refuses a destructive change by default", async () => {
      await repo().apply.execute(spec, { actor: "a", source: "cli" });
      // Refusing unless asked is what makes the gate real rather than advisory.
      await expect(
        repo().apply.execute(withoutBlurb, { actor: "a", source: "chat" }),
      ).rejects.toBeInstanceOf(DestructiveChangeError);
      expect((await repo().specs.find())!.content[0]!.fields.length).toBe(3);
    });

    it("names what would be lost, and how much", async () => {
      await repo().apply.execute(spec, { actor: "a", source: "cli" });
      await db.insert(entries).values([
        {
          siteId: SITE,
          orgId: ORG,
          typeKey: "service",
          slug: "cut",
          data: { name: "Cut", blurb: "x" },
        },
        {
          siteId: SITE,
          orgId: ORG,
          typeKey: "service",
          slug: "colour",
          data: { name: "Colour" },
        },
      ]);

      await expect(
        repo().apply.execute(withoutBlurb, { actor: "a", source: "chat" }),
      ).rejects.toThrow(/2 existing services/);
    });

    it("applies when the caller says so", async () => {
      await repo().apply.execute(spec, { actor: "a", source: "cli" });
      const { changes } = await repo().apply.execute(withoutBlurb, {
        actor: "a",
        source: "cli",
        allowDestructive: true,
      });
      expect(changes.some((c) => c.classification === "destructive")).toBe(true);
      expect((await repo().specs.find())!.content[0]!.fields.length).toBe(2);
    });

    it("marks the stored patch destructive so history reads honestly", async () => {
      await repo().apply.execute(spec, { actor: "a", source: "cli" });
      await repo().apply.execute(withoutBlurb, {
        actor: "a",
        source: "cli",
        allowDestructive: true,
      });
      expect((await repo().history.execute())[0]!.classification).toBe("destructive");
    });
  });

  describe("scoping (ADR 0002 seam 1)", () => {
    it("never reads another site's spec", async () => {
      await repo().apply.execute(spec, { actor: "a", source: "cli" });
      const other = of(OTHER_SITE);
      expect(await other.specs.find()).toBeNull();
    });

    it("never reads another site's entries", async () => {
      await db.insert(entries).values([
        {
          siteId: SITE,
          orgId: ORG,
          typeKey: "service",
          slug: "a",
          data: { name: "Mine" },
        },
        {
          siteId: OTHER_SITE,
          orgId: ORG,
          typeKey: "service",
          slug: "b",
          data: { name: "Theirs" },
        },
      ]);
      const rows = await repo().entries.allOfType("service");
      expect(rows.map((r) => r["name"])).toEqual(["Mine"]);
    });

    it("never reads another org's data even at the same site id", async () => {
      await repo().apply.execute(spec, { actor: "a", source: "cli" });
      const wrongOrg = of(SITE, "org_other");
      expect(await wrongOrg.specs.find()).toBeNull();
    });
  });

  describe("the EntrySource seam pays off (ADR 0007)", () => {
    it("renders a page from database rows with an unchanged renderer", async () => {
      await repo().apply.execute(spec, { actor: "a", source: "cli" });
      await db.insert(entries).values([
        {
          siteId: SITE,
          orgId: ORG,
          typeKey: "service",
          slug: "cut",
          data: { name: "Cut and finish" },
        },
      ]);

      const loaded = (await repo().specs.find())!;
      const source = await repo().read.source(["service"]);

      // The renderer cannot tell these rows came from Postgres rather than from
      // `data/*.yaml` — which is the entire point of drawing the seam in 0a.
      const page = loaded.pages[0]!;
      const { html } = renderPage(page, { spec: loaded, source });
      expect(html).toContain("Cut and finish");
      expect(routes(loaded, source).map((r) => r.path)).toContain("/");
    });
  });

  describe("entry counts", () => {
    it("reports zero for a declared type with no rows", async () => {
      await repo().apply.execute(spec, { actor: "a", source: "cli" });
      // "Nothing is lost" has to be sayable with confidence, not inferred from
      // an absent key.
      expect(await repo().read.counts(spec)).toEqual({ service: 0 });
    });
  });
});
