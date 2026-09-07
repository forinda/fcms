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
 */
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { SiteSpec } from "@forinda-cms/spec";

import { createDb } from "./client.js";
import { SiteRepository } from "./repository.js";
import { organizations, siteSpecs, sites, specPatches } from "./schema.js";

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

/**
 * Derives redirects the way the site service does, from the patch inverses.
 *
 * Duplicated here rather than imported: the service lives in the app, and the
 * app depends on this package, so importing it would invert the dependency.
 * Keeping the rule testable at this level means it is verified even though the
 * wiring is not — and if the two drift, the app is the copy that is wrong.
 */
async function redirects(repo: SiteRepository): Promise<Map<string, string>> {
  const spec = await repo.loadSpec();
  if (!spec) return new Map();

  const live = new Set(spec.pages.map((p) => p.path));
  const byKey = new Map(spec.pages.map((p) => [p.key, p.path]));
  const out = new Map<string, string>();

  for (const patch of await repo.rawHistory(200)) {
    const previous = (patch.inverse as { value?: unknown }[])[0]?.value as
      | { pages?: { key: string; path: string }[] }
      | null
      | undefined;
    for (const old of previous?.pages ?? []) {
      const now = byKey.get(old.key);
      if (!now || now === old.path || live.has(old.path)) continue;
      if (!out.has(old.path)) out.set(old.path, now);
    }
  }
  return out;
}

suite("redirects from the patch spine", () => {
  const repo = () => new SiteRepository(db, { orgId: ORG, siteId: SITE });

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

    expect(Object.fromEntries(await redirects(repo()))).toEqual({ "/book": "/appointments" });
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
    expect(Object.fromEntries(await redirects(repo()))).toEqual({ "/a": "/c", "/b": "/c" });
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
    expect(await redirects(repo())).toEqual(new Map());
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
    expect(await redirects(repo())).toEqual(new Map());
  });
});
