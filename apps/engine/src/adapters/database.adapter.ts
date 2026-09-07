/**
 * The database and everything built on it, as DI bindings.
 *
 * Every service and contributor used to construct its own — `createDb(...)` in a
 * constructor, `new LoginUseCase(db)` at a call site, and the actor contributor
 * doing both **per request**. That worked, because `createDb` caches pools and
 * the use-cases are cheap, but it meant nothing declared its dependencies and
 * nothing could be substituted.
 *
 * Registered here rather than in a module for the reason a global contributor
 * makes unavoidable: `actor` runs on every route, so what it resolves has to
 * exist on every route — independently of which feature modules happen to be
 * mounted. Binding it in `AdminModule` would look tidier and answer 500 on the
 * first authenticated request to a route outside it.
 *
 * `beforeStart` rather than `afterStart`: DI is ready, the server is not
 * listening, and it is the hook that also fires under `createTestApp` — which is
 * what makes these tokens substitutable in a test.
 */
import { defineAdapter, getEnv, getRequestValue, Scope } from "@forinda/kickjs";
import {
  closeAllPools,
  createDb,
  organizations,
  runMigrations,
  sites,
  type Db,
} from "@forinda-cms/db";
import { SiteSpec } from "@forinda-cms/spec";

import { Actor, CURRENT_SCOPE, ResolveSite } from "@/contributors";
import { DB } from "@/shared/db";
import { ApplySpecUseCase } from "@/modules/admin/use-cases/apply-spec.usecase";

// Side-effect import: `src/shared` sits outside every module, so no module glob
// reaches it and its `@Repository` / `@Service` decorators would never run.
import "@/shared";
import { SpecRepository } from "@/shared/repositories";
import { ProvisionOwnerUseCase } from "@/shared/auth/auth.usecase";

export interface DatabaseConfig {
  /** Set false to boot against a database someone else migrates. */
  readonly migrate?: boolean;
}

export const DatabaseAdapter = defineAdapter<DatabaseConfig>({
  name: "DatabaseAdapter",
  defaults: { migrate: true },
  build: (config) => {
    const db = createDb(getEnv("DATABASE_URL"));

    return {
      /**
       * Both contributors, registered here rather than per module.
       *
       * `CURRENT_SITE` reads the scope `ResolveSite` publishes, and `Actor`
       * runs on every route in the deny-by-default tree — so both are needed
       * wherever those bindings are, independently of which modules happen to
       * be mounted. Registering `ResolveSite` in the site module is what made
       * the admin answer 500: its own routes never got a site.
       */
      contributors: () => [ResolveSite.registration, Actor.registration],

      async beforeStart({ container }) {
        // Two bindings, and everything else is a decorated class the container
        // finds on its own: the repositories and use-cases live under `src/`
        // now, so the module glob eagerly imports them and their decorators
        // register them. That is the whole reason they moved — a class inside a
        // workspace package is never globbed, its decorator never runs, and
        // asking for it fails at the first request rather than at boot.
        container.registerInstance(DB, db);

        container.registerFactory(
          CURRENT_SCOPE,
          () => {
            // `getRequestValue` rather than a `ctx` reference: this factory has
            // no request object, and the site contributor already published the
            // scope under `site` (doc 03 §4).
            const scope = getRequestValue("site");
            if (!scope) throw new Error("no site on this request — is ResolveSite applied?");
            return scope;
          },
          Scope.REQUEST,
        );

        if (config.migrate === false) return;

        // Migrations on boot, not as a separate command — a self-hoster will
        // not run one (doc 09 target B). Safe every time because the ledger
        // lives in the target database, so a completed migration is a no-op and
        // an interrupted one resumes.
        await runMigrations(db);
        await provision(db);
      },

      async shutdown() {
        await closeAllPools();
      },
    };
  },
});

/**
 * First boot: the org, the site, an owner, and something to look at.
 *
 * Not a setup wizard — that needs the admin. This is the smallest thing that
 * makes `docker compose up` reach a working site rather than a 404 and an
 * instruction.
 */
async function provision(db: Db): Promise<void> {
  const orgId = getEnv("ORG_ID");
  const siteId = getEnv("SITE_ID");

  await db.insert(organizations).values({ id: orgId, name: "Default" }).onConflictDoNothing();
  await db
    .insert(sites)
    .values({
      id: siteId,
      orgId,
      slug: siteId,
      name: getEnv("SITE_NAME") ?? "A new site",
      timezone: getEnv("SITE_TIMEZONE"),
    })
    .onConflictDoNothing();

  // Once. `ProvisionOwnerUseCase` refuses if any owner exists, so a restart with
  // the env still set cannot add a second, and a leaked variable cannot mint one
  // on a running install.
  const email = getEnv("OWNER_EMAIL");
  const password = getEnv("OWNER_PASSWORD");
  if (email && password) {
    const created = await new ProvisionOwnerUseCase(db).execute({ orgId, email, password });
    if (created) console.log(`[install] created the first owner: ${created.email}`);
  }

  // Boot has no request, so these are constructed rather than resolved — the
  // same constructors the container calls, with the scope this install is
  // configured for.
  const scope = { orgId, siteId };
  if (!(await new SpecRepository(db, scope).find())) {
    await new ApplySpecUseCase(db, scope).execute(
      SiteSpec.parse(starterSpec(getEnv("SITE_NAME"))),
      {
        actor: "install",
        source: "boot",
      },
    );
  }
}

function starterSpec(name: string | undefined) {
  const title = name ?? "A new site";
  return {
    specVersion: 1 as const,
    name: title,
    theme: {
      colors: { brand: "#1a7f5a", text: "#1c1917", background: "#ffffff", surface: "#f7f5f2" },
      fonts: { body: "Inter" },
      typeScale: { sm: "0.875rem", md: "1rem", lg: "1.5rem", xl: "2.5rem" },
    },
    content: [],
    pages: [
      {
        key: "home",
        path: "/",
        title,
        blocks: [
          {
            type: "section",
            style: { padding: { y: "xl", x: "lg" }, width: "narrow" },
            children: [
              { type: "heading", attrs: { text: title, level: 1 }, style: { fontSize: "xl" } },
              {
                type: "text",
                attrs: {
                  text: "This site is running. Edit it with `fcms` — or point an AI at it once the chat surface exists.",
                },
              },
            ],
          },
        ],
      },
    ],
  };
}
