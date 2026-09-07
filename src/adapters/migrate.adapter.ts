/**
 * Run migrations and provision the first site before the server accepts traffic.
 *
 * Doc 09's install artifact turns on this: *"migrations run on boot, not as a
 * separate command. A self-hoster will not run `pnpm db:migrate`."* Asking them
 * to is the friction the whole target-B argument exists to remove.
 *
 * It is safe to do on every boot because Drizzle keeps its ledger inside the
 * target database, so a migration that already ran is a no-op and one that died
 * halfway resumes — the property `enaton` relies on for tenant provisioning
 * (doc 09 §6).
 *
 * `beforeStart` rather than `afterStart`: DI is ready, the server is not
 * listening yet, and a request must never arrive against a half-migrated
 * database.
 */
import { defineAdapter, getEnv } from "@forinda/kickjs";
import { SiteSpec } from "@forinda-cms/spec";
import {
  ProvisionOwnerUseCase,
  Site,
  createDb,
  organizations,
  runMigrations,
  sites,
} from "@forinda-cms/db";

export interface MigrateConfig {
  /** Set false to boot against a database someone else migrates. */
  readonly enabled?: boolean;
}

export const MigrateAdapter = defineAdapter<MigrateConfig>({
  name: "MigrateAdapter",
  defaults: { enabled: true },
  build: (config) => ({
    async beforeStart() {
      if (config.enabled === false) return;

      const db = createDb(getEnv("DATABASE_URL"));
      await runMigrations(db);

      // First boot: make the org and site the single-site install serves from,
      // so `docker compose up` reaches a working server rather than a 404 and
      // an instruction to run something.
      //
      // Not a setup wizard — that needs the admin, which is Phase 0b's other
      // half. This is the smallest thing that makes the install honest.
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

      // The first owner, once. `ProvisionOwnerUseCase` refuses if any owner
      // exists, so a restart with the env still set cannot add a second — and a
      // leaked env var cannot mint one on a running install.
      const email = getEnv("OWNER_EMAIL");
      const password = getEnv("OWNER_PASSWORD");
      if (email && password) {
        const created = await new ProvisionOwnerUseCase(db).execute({ orgId, email, password });
        if (created) console.log(`[install] created the first owner: ${created.email}`);
      }

      const site = new Site(db, { orgId, siteId });
      if (!(await site.spec())) {
        // A placeholder, deliberately obvious. An empty site that renders
        // nothing looks broken; one that says what to do next does not.
        await site.applySpec(SiteSpec.parse(starterSpec(getEnv("SITE_NAME"))), {
          actor: "install",
          source: "boot",
        });
      }
    },
  }),
});

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
