/**
 * The tick that makes automations run (ADR 0024 §2).
 *
 * A timer in the process rather than a queue service: a self-hosted install is
 * one `docker compose up` (doc 09), and a second thing to run is a reason not
 * to install the product. The table is the queue, `FOR UPDATE SKIP LOCKED`
 * makes it safe for more than one instance, and this only decides how often
 * somebody looks.
 *
 * Off in tests unless asked for: a background timer writing rows while a suite
 * truncates tables is a flake generator, and every suite here shares one
 * database.
 */
import { defineAdapter, getEnv } from "@forinda/kickjs";
import { createDb, sites } from "@forinda-cms/db";
import { eq } from "drizzle-orm";

import { SpecRepository } from "@/shared/repositories";
import { WorkflowUseCase } from "@/shared/workflows/workflow.usecase";

export interface WorkflowsConfig {
  /** How often to look for due work. Seconds. */
  readonly every?: number;
  readonly enabled?: boolean;
}

export const WorkflowsAdapter = defineAdapter<WorkflowsConfig>({
  name: "WorkflowsAdapter",
  defaults: { every: 15, enabled: true },
  build: (config) => {
    let timer: NodeJS.Timeout | undefined;

    return {
      async afterStart() {
        if (config.enabled === false || getEnv("NODE_ENV") === "test") return;

        const db = createDb(getEnv("DATABASE_URL"));
        const orgId = getEnv("ORG_ID");

        const tick = async () => {
          try {
            // Every site on this install, because a schedule belongs to a site
            // and nothing has made a request to tell us which one.
            for (const site of await db.select().from(sites).where(eq(sites.orgId, orgId))) {
              const scope = { orgId, siteId: site.id };
              const spec = await new SpecRepository(db, scope).find();
              if (!spec) continue;

              const workflows = new WorkflowUseCase(db, scope);
              await workflows.enqueueDue(spec);
              await workflows.runDue(spec);
            }
          } catch (error) {
            // A tick that throws must not take the timer with it: the next one
            // is the retry, and the run rows already carry the real errors.
            console.error("[workflows] tick failed", error);
          }
        };

        timer = setInterval(tick, (config.every ?? 15) * 1000);
        // Never the reason a process stays alive.
        timer.unref();
        void tick();
      },

      async shutdown() {
        if (timer) clearInterval(timer);
      },
    };
  },
});
