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
import { EntryWriteUseCase } from "@/modules/admin/use-cases/entries.usecase";
import { SiteHistoryUseCase } from "@/modules/admin/use-cases/site-history.usecase";
import { UndoSpecUseCase } from "@/modules/admin/use-cases/undo-spec.usecase";

const url = process.env["DATABASE_URL"];
const suite = url ? describe : describe.skip;

const db = url ? createDb(url) : (undefined as never);

const ORG = "org_test";
const SITE = "site_test";
const OTHER_SITE = "site_other";

const spec = SiteSpec.parse({
  specVersion: 2,
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
      writer: new EntryWriteUseCase(db, scope),
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
      await repo().apply.execute(spec, { actor: "test", role: "owner" as const, source: "cli" });
      const loaded = await repo().specs.find();
      // Parsed on the way out, so a document written by an older version cannot
      // reach the renderer unvalidated.
      expect(loaded).toEqual(spec);
    });

    it("records an inverse for every change, never null", async () => {
      await repo().apply.execute(spec, { actor: "test", role: "owner" as const, source: "cli" });
      const [patch] = await db.select().from(specPatches).where(eq(specPatches.siteId, SITE));
      expect(patch!.inverse).toBeTruthy();
      // Doc 13's argument that a non-developer can review rests on a wrong "yes"
      // being cheap, which is only true because this is written at the time.
      expect(Array.isArray(patch!.inverse)).toBe(true);
    });

    it("numbers patches per site, monotonically", async () => {
      await repo().apply.execute(spec, { actor: "a", role: "owner" as const, source: "cli" });
      await repo().apply.execute(
        { ...spec, name: "Renamed" },
        { actor: "b", role: "owner" as const, source: "chat" },
      );
      const history = await repo().history.execute();
      expect(history.map((h) => h.seq)).toEqual([2, 1]);
      expect(history[0]!.source).toBe("chat");
    });

    it("undoes the last change and leaves the history intact", async () => {
      await repo().apply.execute(spec, { actor: "a", role: "owner" as const, source: "cli" });
      await repo().apply.execute(
        { ...spec, name: "Renamed" },
        { actor: "b", role: "owner" as const, source: "chat" },
      );
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
      await repo().apply.execute(spec, { actor: "a", role: "owner" as const, source: "cli" });
      await repo().undo.execute();
      expect(await repo().specs.find()).toBeNull();
    });
  });

  describe("the destructive gate", () => {
    it("refuses a destructive change by default", async () => {
      await repo().apply.execute(spec, { actor: "a", role: "owner" as const, source: "cli" });
      // Refusing unless asked is what makes the gate real rather than advisory.
      await expect(
        repo().apply.execute(withoutBlurb, { actor: "a", role: "owner" as const, source: "chat" }),
      ).rejects.toBeInstanceOf(DestructiveChangeError);
      expect((await repo().specs.find())!.content[0]!.fields.length).toBe(3);
    });

    it("names what would be lost, and how much", async () => {
      await repo().apply.execute(spec, { actor: "a", role: "owner" as const, source: "cli" });
      await db.insert(entries).values([
        {
          siteId: SITE,
          orgId: ORG,
          typeKey: "service",
          slug: "cut",
          data: { name: "Cut", blurb: "x" },
          status: "published",
        },
        {
          siteId: SITE,
          orgId: ORG,
          typeKey: "service",
          slug: "colour",
          data: { name: "Colour" },
          status: "published",
        },
      ]);

      await expect(
        repo().apply.execute(withoutBlurb, { actor: "a", role: "owner" as const, source: "chat" }),
      ).rejects.toThrow(/2 existing services/);
    });

    it("applies when the caller says so", async () => {
      await repo().apply.execute(spec, { actor: "a", role: "owner" as const, source: "cli" });
      const { changes } = await repo().apply.execute(withoutBlurb, {
        actor: "a",
        role: "owner" as const,
        source: "cli",
        allowDestructive: true,
      });
      expect(changes.some((c) => c.classification === "destructive")).toBe(true);
      expect((await repo().specs.find())!.content[0]!.fields.length).toBe(2);
    });

    it("marks the stored patch destructive so history reads honestly", async () => {
      await repo().apply.execute(spec, { actor: "a", role: "owner" as const, source: "cli" });
      await repo().apply.execute(withoutBlurb, {
        actor: "a",
        role: "owner" as const,
        source: "cli",
        allowDestructive: true,
      });
      expect((await repo().history.execute())[0]!.classification).toBe("destructive");
    });
  });

  describe("scoping (ADR 0002 seam 1)", () => {
    it("never reads another site's spec", async () => {
      await repo().apply.execute(spec, { actor: "a", role: "owner" as const, source: "cli" });
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
          status: "published",
        },
        {
          siteId: OTHER_SITE,
          orgId: ORG,
          typeKey: "service",
          slug: "b",
          data: { name: "Theirs" },
          status: "published",
        },
      ]);
      const rows = await repo().entries.allOfType("service");
      expect(rows.map((r) => r["name"])).toEqual(["Mine"]);
    });

    it("never reads another org's data even at the same site id", async () => {
      await repo().apply.execute(spec, { actor: "a", role: "owner" as const, source: "cli" });
      const wrongOrg = of(SITE, "org_other");
      expect(await wrongOrg.specs.find()).toBeNull();
    });
  });

  describe("the EntrySource seam pays off (ADR 0007)", () => {
    it("renders a page from database rows with an unchanged renderer", async () => {
      await repo().apply.execute(spec, { actor: "a", role: "owner" as const, source: "cli" });
      await db.insert(entries).values([
        {
          siteId: SITE,
          orgId: ORG,
          typeKey: "service",
          slug: "cut",
          data: { name: "Cut and finish" },
          status: "published",
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

  describe("writing an entry", () => {
    const entry = (slug: string) => ({
      typeKey: "service",
      slug,
      data: { slug, name: "Cut", blurb: "A cut" },
    });

    it("refuses a slug another entry already uses, as a field error", async () => {
      await repo().apply.execute(spec, { actor: "a", role: "owner" as const, source: "cli" });
      const writer = repo().writer;

      expect((await writer.create(spec, entry("cut"))).ok).toBe(true);
      const second = await writer.create(spec, entry("cut"));

      // A taken slug is a field the caller can fix. Left to propagate, the
      // unique violation answered 500 with a SQL statement in the log: a form
      // would show no error, and an agent would report the site as broken.
      expect(second.ok).toBe(false);
      expect(second.ok === false && second.errors["slug"]).toMatch(/already uses/);
    });

    it("refuses the same on update, not only on create", async () => {
      await repo().apply.execute(spec, { actor: "a", role: "owner" as const, source: "cli" });
      const writer = repo().writer;

      await writer.create(spec, entry("cut"));
      const other = await writer.create(spec, entry("colour"));
      expect(other.ok).toBe(true);

      const clash = other.ok ? await writer.update(spec, other.entry.id, entry("cut")) : null;

      expect(clash?.ok).toBe(false);
      expect(clash && clash.ok === false && clash.errors["slug"]).toMatch(/already uses/);
    });
  });

  describe("publishing", () => {
    const entry = (slug: string) => ({
      typeKey: "service",
      slug,
      data: { slug, name: "Cut", blurb: "A cut" },
    });

    it("keeps a draft off the public site", async () => {
      await repo().apply.execute(spec, { actor: "a", role: "owner" as const, source: "cli" });
      const created = await repo().writer.create(spec, entry("cut"));
      expect(created.ok).toBe(true);

      // `status` was stored, indexed, and read by nothing: every draft was
      // being served. "Save it and finish it tomorrow" published it.
      const source = await repo().read.source(["service"]);
      expect(source.all("service")).toEqual([]);
    });

    it("shows it once published, and hides it again when unpublished", async () => {
      await repo().apply.execute(spec, { actor: "a", role: "owner" as const, source: "cli" });
      const created = await repo().writer.create(spec, entry("cut"));
      const id = created.ok ? created.entry.id : "";

      expect(await repo().writer.setStatus(id, "published")).toBe(true);
      expect((await repo().read.source(["service"])).all("service")).toHaveLength(1);

      expect(await repo().writer.setStatus(id, "draft")).toBe(true);
      expect((await repo().read.source(["service"])).all("service")).toEqual([]);
    });

    it("still lists drafts for the admin, and counts them", async () => {
      await repo().apply.execute(spec, { actor: "a", role: "owner" as const, source: "cli" });
      await repo().writer.create(spec, entry("cut"));

      // The admin has to see what the public cannot, or nobody could publish it.
      expect(await repo().read.rows("service")).toHaveLength(1);
      expect((await repo().read.drafts())["service"]).toBe(1);
    });

    it("refuses to publish an entry from another site", async () => {
      await repo().apply.execute(spec, { actor: "a", role: "owner" as const, source: "cli" });
      const created = await repo().writer.create(spec, entry("cut"));
      const id = created.ok ? created.entry.id : "";

      // A valid uuid from a request must not reach another site's row.
      expect(await of(OTHER_SITE).writer.setStatus(id, "published")).toBe(false);
    });
  });

  describe("entry counts", () => {
    it("reports zero for a declared type with no rows", async () => {
      await repo().apply.execute(spec, { actor: "a", role: "owner" as const, source: "cli" });
      // "Nothing is lost" has to be sayable with confidence, not inferred from
      // an absent key.
      expect(await repo().read.counts(spec)).toEqual({ service: 0 });
    });
  });
  /**
   * A partial update says nothing about the address (ADR 0044).
   *
   * The API takes `{ data }` on its own, and the admin application sends exactly
   * that. Writing `slug: null` for an unmentioned slug unpublishes the page an
   * entry is already served at — found by editing a service's price in the new
   * app and watching its address disappear.
   */
  describe("updating an entry without mentioning its slug", () => {
    it("keeps the address it already had", async () => {
      const { apply, writer, entries } = of();
      await apply.execute(spec, { actor: "test", role: "owner", source: "cli" });

      const made = await writer.create(spec, {
        typeKey: "service",
        slug: "cut",
        data: { name: "Cut", slug: "cut" },
      });
      expect(made.ok).toBe(true);
      const id = made.ok ? made.entry!.id : "";

      await writer.update(spec, id, {
        typeKey: "service",
        data: { name: "Cut and finish", slug: "cut" },
      });

      expect((await entries.byId(id))?.slug).toBe("cut");
    });

    it("still clears it when the caller means to", async () => {
      const { apply, writer, entries } = of();
      await apply.execute(spec, { actor: "test", role: "owner", source: "cli" });

      const made = await writer.create(spec, {
        typeKey: "service",
        slug: "trim",
        data: { name: "Trim", slug: "trim" },
      });
      const id = made.ok ? made.entry!.id : "";

      // The declared `slug` field stays — it is a field like any other. What
      // is being cleared is the address column, which is what an empty `slug`
      // on the input means.
      await writer.update(spec, id, {
        typeKey: "service",
        slug: "",
        data: { name: "Trim", slug: "trim" },
      });
      expect((await entries.byId(id))?.slug).toBeNull();
    });
  });
});
