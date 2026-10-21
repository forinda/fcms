/**
 * `inSite`: a unit of work for one site, outside a request.
 *
 * The workflow tick runs every site through it, one after another, and nothing
 * else tells those runs apart. A unit that leaked its site into the next — or
 * never set one — would run one site's automations against another's rows,
 * with no error to read.
 */
import { describe, expect, it } from "vitest";
import { Container, Inject, Scope as Lifetime, Service, requestStore } from "@forinda/kickjs";
import type { Scope } from "@forinda-cms/db";

import { CURRENT_SCOPE, currentScope, inSite } from "../site.contributor";

@Service({ scope: Lifetime.REQUEST })
class WhichSite {
  constructor(@Inject(CURRENT_SCOPE) readonly scope: Scope) {}
}

const container = () => {
  Container.setRequestStoreProvider(() => requestStore.getStore() ?? null);
  const c = Container.create();
  // The factory the database adapter registers, not a stand-in for it.
  c.registerFactory(CURRENT_SCOPE, currentScope, Lifetime.REQUEST);
  return c;
};

const one = { orgId: "org", siteId: "one" };
const two = { orgId: "org", siteId: "two" };

describe("inSite", () => {
  it("resolves the site it was given, across an await", async () => {
    const c = container();
    const seen = await Promise.all(
      [one, two].map((scope) =>
        inSite(scope, async () => {
          // Interleaved on purpose: both units are open at once here.
          await new Promise((r) => setTimeout(r, 5));
          return c.resolve(WhichSite).scope.siteId;
        }),
      ),
    );
    expect(seen).toEqual(["one", "two"]);
  });

  it("builds afresh in each unit, rather than reusing the last site's", async () => {
    const c = container();
    const first = await inSite(one, async () => c.resolve(WhichSite));
    const second = await inSite(two, async () => c.resolve(WhichSite));
    expect(second).not.toBe(first);
    expect(second.scope.siteId).toBe("two");
  });

  it("has no site outside one", () => {
    expect(() => container().resolve(WhichSite)).toThrow();
  });
});
