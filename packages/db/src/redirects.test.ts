/**
 * Redirects derived from history.
 *
 * ADR 0002 put structural SEO in Phase 0b for one specific reason: *"the
 * automatic 301 only works because the patch inverse already recorded the old
 * path."* This is that claim under test — nobody writes a redirect rule, and a
 * page that moves keeps its search traffic.
 *
 * Doc 08 calls it the highest-value item on the SEO list, because losing
 * rankings on a rename is the most common regret of anyone who migrates.
 *
 * Tests the real `RedirectsUseCase` now. The first version reimplemented the
 * rule here, because it lived in the app and the app depends on this package —
 * so the test verified a copy rather than the thing that runs. Moving it into a
 * use-case fixed that as a side effect, which is a fair argument for the shape.
 */
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { SiteSpec } from "@forinda-cms/spec";

import { createDb } from "./client.js";
import { Site } from "./site.js";
import { organizations, siteSpecs, sites, specPatches } from "./schema/index.js";

const url = process.env["DATABASE_URL"];
const suite = url ? describe : describe.skip;
const db = url ? createDb(url) : (undefined as never);

const ORG = "org_redirect";
const SITE = "site_redirect";

const page = (key: string, path: string) => ({ key, path, title: key, blocks: [] });

const specWith = (pages: unknown[]) =>
  SiteSpec.parse({
    specVersion: 1,
    name: "Test",
    theme: { colors: { brand: "#000000" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
    content: [],
    pages,
  });

suite("redirects from the patch spine", () => {
  const repo = () => new Site(db, { orgId: ORG, siteId: SITE });

  const reset = async () => {
    await db.delete(specPatches).where(eq(specPatches.orgId, ORG));
    await db.delete(siteSpecs).where(eq(siteSpecs.orgId, ORG));
    await db.delete(sites).where(eq(sites.orgId, ORG));
    await db.delete(organizations).where(eq(organizations.id, ORG));
    await db.insert(organizations).values({ id: ORG, name: "Redirect org" });
    await db.insert(sites).values({ id: SITE, orgId: ORG, slug: "r", name: "R" });
  };

  it("redirects a moved page without anyone writing a rule", async () => {
    await reset();
    await repo().applySpec(specWith([page("book", "/book")]), { actor: "a", source: "cli" });
    await repo().applySpec(specWith([page("book", "/appointments")]), {
      actor: "a",
      source: "cli",
      allowDestructive: true,
    });

    expect(Object.fromEntries(await repo().redirects())).toEqual({ "/book": "/appointments" });
  });

  it("follows a page moved twice to its current address", async () => {
    await reset();
    await repo().applySpec(specWith([page("book", "/a")]), { actor: "a", source: "cli" });
    await repo().applySpec(specWith([page("book", "/b")]), {
      actor: "a",
      source: "cli",
      allowDestructive: true,
    });
    await repo().applySpec(specWith([page("book", "/c")]), {
      actor: "a",
      source: "cli",
      allowDestructive: true,
    });

    // Both old addresses point at where the page actually is, not at each
    // other — a redirect chain costs rankings almost as much as a 404.
    expect(Object.fromEntries(await repo().redirects())).toEqual({ "/a": "/c", "/b": "/c" });
  });

  it("does not redirect a deleted page", async () => {
    await reset();
    await repo().applySpec(specWith([page("book", "/book"), page("home", "/")]), {
      actor: "a",
      source: "cli",
    });
    await repo().applySpec(specWith([page("home", "/")]), {
      actor: "a",
      source: "cli",
      allowDestructive: true,
    });

    // A deleted page has nowhere to send anyone. Redirecting to the homepage
    // would tell a search engine the content moved when it did not — worse for
    // the owner than an honest 404.
    expect(await repo().redirects()).toEqual(new Map());
  });

  it("does not redirect a path another page now occupies", async () => {
    await reset();
    await repo().applySpec(specWith([page("book", "/book")]), { actor: "a", source: "cli" });
    await repo().applySpec(specWith([page("book", "/appointments"), page("other", "/book")]), {
      actor: "a",
      source: "cli",
      allowDestructive: true,
    });

    // `/book` is live again under a different page. Redirecting it would make
    // the new page unreachable.
    expect(await repo().redirects()).toEqual(new Map());
  });
});
