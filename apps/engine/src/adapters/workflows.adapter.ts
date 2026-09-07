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

/**
 * Which application owns the schedule, across module reloads.
 *
 * A closure-local flag cannot answer this. Under `kick dev` a reload replaces
 * the module graph, and an interval created in the *previous* graph keeps its
 * own copy of every variable in this file — it cannot see a newer application
 * start, and it goes on calling code whose imports the reload has since
 * replaced. That is what produced `migrateSpec is not a function` on a timer,
 * repeating forever, from a file nobody was editing.
 *
 * `Symbol.for` puts the counter on the process rather than in a module, so a
 * tick from a superseded graph can see that it has been superseded — and stops
 * itself the moment it fires.
 */
const GENERATION = Symbol.for("forinda-cms.workflows.generation");

function claim(): number {
  const host = globalThis as unknown as Record<symbol, number | undefined>;
  const mine = (host[GENERATION] ?? 0) + 1;
  host[GENERATION] = mine;
  return mine;
}

function owns(generation: number): boolean {
  return (globalThis as unknown as Record<symbol, number | undefined>)[GENERATION] === generation;
}

export const WorkflowsAdapter = defineAdapter<WorkflowsConfig>({
  name: "WorkflowsAdapter",
  defaults: { every: 15, enabled: true },
  build: (config) => {
    let timer: NodeJS.Timeout | undefined;
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };

    return {
      async afterStart() {
        // Both halves matter: this clears the timer *this* module made, and the
        // generation stops the ones an earlier module graph made.
        stop();
        const generation = claim();
        if (config.enabled === false || getEnv("NODE_ENV") === "test") return;

        const db = createDb(getEnv("DATABASE_URL"));
        const orgId = getEnv("ORG_ID");

        const tick = async () => {
          // A tick that has been superseded does nothing, and takes its own
          // timer with it.
          if (!owns(generation)) {
            clearInterval(started);
            return;
          }

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

        const started = setInterval(tick, (config.every ?? 15) * 1000);
        // Never the reason a process stays alive.
        started.unref();
        timer = started;

        void tick();
      },

      async shutdown() {
        stop();
      },
    };
  },
});

/** Exported for the test that pins the generation rule. */
export const workflowsTicker = { claim, owns, GENERATION };
