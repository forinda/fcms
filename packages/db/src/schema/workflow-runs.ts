/**
 * The workflow queue, as a table (ADR 0024 §2).
 *
 * A row per trigger event, claimed by a runner and retried on failure. Postgres
 * rather than Redis, because a self-hosted install is one `docker compose up`
 * (doc 09) and a second piece of infrastructure to run is a reason not to
 * install the product at all. `FOR UPDATE SKIP LOCKED` is what makes this a
 * queue rather than a table people race on.
 *
 * The row is also the audit trail. "Text me when someone books" failing
 * silently is the worst outcome this feature has, so a failure is a row an
 * owner can read, with the error on it, rather than a line in a log nobody
 * opens.
 */
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { createdAt, pk } from "./_shared.js";
import { sites } from "./sites.js";

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: pk(),
    siteId: text()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    orgId: text().notNull(),

    /** The `logic` key this run is for. */
    workflowKey: text().notNull(),
    /** What fired it: `entry.created`, `schedule`, … */
    trigger: text().notNull(),
    /** The entry the trigger was about, where there was one. */
    entryId: text(),

    /**
     * The dedupe key for a run that must happen once.
     *
     * A scheduled workflow is due at a minute, not continuously: two app
     * instances ticking at the same second would otherwise both enqueue it.
     * Null for event triggers, which are already one event per row.
     */
    dedupe: text(),

    /** pending | running | done | failed */
    status: text().notNull().default("pending"),
    attempts: integer().notNull().default(0),
    /** When this becomes eligible — now, or after a backoff. */
    runAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** What went wrong last time, in the owner's view. */
    lastError: text(),
    /** What each step did, for the run history. */
    detail: jsonb().$type<Record<string, unknown>>(),

    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("workflow_runs_dedupe").on(t.siteId, t.workflowKey, t.dedupe),
    // The claim query's index: due, pending, oldest first.
    index("workflow_runs_due").on(t.status, t.runAt),
    index("workflow_runs_site_created").on(t.siteId, t.createdAt),
  ],
);

export type WorkflowRunRow = typeof workflowRuns.$inferSelect;
export type NewWorkflowRunRow = typeof workflowRuns.$inferInsert;
