/**
 * The container, outside the application — a script, a test.
 *
 * What the database adapter and `ResolveSite` provide inside a running app,
 * done by hand: `DB` bound, the site bound when there is one, and resolution
 * inside a unit of work, since most use-cases are request-scoped. Everything
 * else is the container building the same graph it builds for a request, so a
 * test exercises the wiring rather than a hand-assembled copy of it.
 *
 * Isolated per call (`Container.create()`), so one suite's bindings never leak
 * into another's.
 */
import { Container, requestStore } from "@forinda/kickjs";
import type { Db, Scope } from "@forinda-cms/db";

import { DB } from "@/shared/db";
import { CURRENT_SCOPE } from "@/contributors/site.contributor";

/**
 * @param bind Anything else the code under test needs that an adapter would
 *   bind in the app — `STORAGE` for media, say.
 */
export function standalone(db: Db, scope?: Scope, bind?: (container: Container) => void) {
  // The framework installs this at bootstrap; outside one nothing has.
  Container.setRequestStoreProvider(() => requestStore.getStore() ?? null);

  const container = Container.create();
  container.registerInstance(DB, db);
  if (scope) container.registerInstance(CURRENT_SCOPE, scope);
  bind?.(container);

  const unit = { requestId: "standalone", instances: new Map(), values: new Map() };
  return <T>(service: new (...args: never[]) => T): T =>
    requestStore.run(unit, () => container.resolve(service));
}
