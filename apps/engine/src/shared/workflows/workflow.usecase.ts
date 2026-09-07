/**
 * Running what `logic` declares (ADR 0024).
 *
 * Enqueue on the event, run on a tick. A workflow never runs inside the request
 * that triggered it: the write belongs to a customer and the automation belongs
 * to the owner, so a slow webhook must not make a booking slower and a broken
 * one must not fail it.
 */
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";
import { and, eq, lte, sql } from "drizzle-orm";
import { matches } from "@forinda-cms/render";
import type { SiteSpec, Workflow } from "@forinda-cms/spec";
import { entries, workflowRuns, type EntryRow, type WorkflowRunRow } from "@forinda-cms/db";
import type { Db, Scope } from "@forinda-cms/db";

import { DB } from "@/shared/db";
import { CURRENT_SCOPE } from "@/contributors/site.contributor";
import { ACTION_REGISTRY } from "./actions";
import { parseCron } from "./cron";

/** What happened, and what the platform knows about it. */
export interface TriggerEvent {
  readonly on: "entry.created" | "entry.updated" | "entry.transitioned" | "payment.succeeded";
  readonly typeKey: string;
  readonly entryId: string;
  /** For a transition: the state it moved to. */
  readonly to?: string | undefined;
}

/** Five attempts over about ten minutes, then it stops and says why. */
const MAX_ATTEMPTS = 5;
const BACKOFF_SECONDS = [10, 30, 120, 600];

@Service({ scope: Lifetime.REQUEST })
export class WorkflowUseCase {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CURRENT_SCOPE) private readonly scope: Scope,
  ) {}

  /**
   * Queue whatever this event triggers.
   *
   * Called after the write it describes has committed — a workflow that fired
   * for a row that then failed to save would be worse than one that fired late.
   */
  async enqueue(spec: SiteSpec, event: TriggerEvent): Promise<number> {
    const due = spec.logic.filter((w) => w.enabled !== false && fires(w, event));
    if (due.length === 0) return 0;

    await this.db.insert(workflowRuns).values(
      due.map((w) => ({
        siteId: this.scope.siteId,
        orgId: this.scope.orgId,
        workflowKey: w.key,
        trigger: event.on,
        entryId: event.entryId,
      })),
    );
    return due.length;
  }

  /**
   * Queue the scheduled workflows that are due this minute.
   *
   * The dedupe key is the workflow and the minute, so two app instances ticking
   * at the same second enqueue one run between them — the unique index decides,
   * rather than a lock somebody has to remember to take.
   */
  async enqueueDue(spec: SiteSpec, now = new Date()): Promise<number> {
    const minute = now.toISOString().slice(0, 16);
    const due = spec.logic.filter(
      (w) =>
        w.enabled !== false &&
        w.trigger.on === "schedule" &&
        parseCron(w.trigger.cron)?.matches(now) === true,
    );
    if (due.length === 0) return 0;

    const inserted = await this.db
      .insert(workflowRuns)
      .values(
        due.map((w) => ({
          siteId: this.scope.siteId,
          orgId: this.scope.orgId,
          workflowKey: w.key,
          trigger: "schedule",
          dedupe: `${minute}`,
        })),
      )
      .onConflictDoNothing()
      .returning();

    return inserted.length;
  }

  /**
   * Take up to `limit` due runs and execute them.
   *
   * `FOR UPDATE SKIP LOCKED` is what makes the table a queue: two runners take
   * different rows rather than the same one twice, and neither waits.
   */
  async runDue(spec: SiteSpec, limit = 10): Promise<WorkflowRunRow[]> {
    const claimed = await this.db.transaction(async (tx) => {
      const due = await tx
        .select({ id: workflowRuns.id })
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.siteId, this.scope.siteId),
            eq(workflowRuns.status, "pending"),
            lte(workflowRuns.runAt, new Date()),
          ),
        )
        .orderBy(workflowRuns.runAt)
        .limit(limit)
        .for("update", { skipLocked: true });

      if (due.length === 0) return [];

      return tx
        .update(workflowRuns)
        .set({ status: "running", updatedAt: new Date() })
        .where(
          sql`${workflowRuns.id} in (${sql.join(
            due.map((row) => sql`${row.id}`),
            sql`, `,
          )})`,
        )
        .returning();
    });

    const done: WorkflowRunRow[] = [];
    for (const run of claimed) done.push(await this.execute(spec, run));
    return done;
  }

  /** One run: every step in order, and the first failure stops it. */
  private async execute(spec: SiteSpec, run: WorkflowRunRow): Promise<WorkflowRunRow> {
    const workflow = spec.logic.find((w) => w.key === run.workflowKey);
    if (!workflow) return this.finish(run, "done", { note: "the automation no longer exists" });

    const entry = run.entryId ? await this.entry(run.entryId) : undefined;
    const type = spec.content.find((t) => t.key === entry?.typeKey);
    const steps: string[] = [];

    try {
      for (const step of workflow.steps) {
        // `when` on a step is evaluated against the entry, so one automation can
        // do different things for different rows without two automations.
        if (step.when && entry && !matches(entry.data as never, step.when)) {
          steps.push(`${step.action}: skipped`);
          continue;
        }

        const action = ACTION_REGISTRY[step.action];
        if (!action) throw new Error(`no action called "${step.action}"`);

        steps.push(
          `${step.action}: ${await action.run({
            spec,
            entry,
            type,
            params: step.params ?? {},
            setState: (id, field, to) => this.setState(id, field, to),
          })}`,
        );
      }
      return this.finish(run, "done", { steps });
    } catch (error) {
      return this.retry(run, error instanceof Error ? error.message : String(error), steps);
    }
  }

  /**
   * Back off and try again, or stop and say why.
   *
   * The row is the audit trail: an automation that quietly stopped working is
   * the failure this feature must not have, so a dead run is a thing an owner
   * can read with the error on it.
   */
  private async retry(run: WorkflowRunRow, error: string, steps: string[]) {
    const attempts = run.attempts + 1;
    const wait = BACKOFF_SECONDS[attempts - 1];

    if (attempts >= MAX_ATTEMPTS || wait === undefined) {
      return this.finish(run, "failed", { steps }, error, attempts);
    }

    const [row] = await this.db
      .update(workflowRuns)
      .set({
        status: "pending",
        attempts,
        lastError: error,
        detail: { steps },
        runAt: new Date(Date.now() + wait * 1000),
        updatedAt: new Date(),
      })
      .where(eq(workflowRuns.id, run.id))
      .returning();
    return row ?? run;
  }

  private async finish(
    run: WorkflowRunRow,
    status: "done" | "failed",
    detail: Record<string, unknown>,
    error?: string,
    attempts = run.attempts + 1,
  ) {
    const [row] = await this.db
      .update(workflowRuns)
      .set({
        status,
        attempts,
        detail,
        lastError: error ?? null,
        updatedAt: new Date(),
      })
      .where(eq(workflowRuns.id, run.id))
      .returning();
    return row ?? run;
  }

  private async entry(id: string): Promise<EntryRow | undefined> {
    const [row] = await this.db
      .select()
      .from(entries)
      .where(and(eq(entries.siteId, this.scope.siteId), eq(entries.id, id)))
      .limit(1);
    return row;
  }

  /** The one write an action may make, and only through here. */
  private async setState(entryId: string, field: string, to: string): Promise<void> {
    await this.db
      .update(entries)
      .set({
        // The path is `text[]`, and a bound string is not one — without the cast
        // this ran, reported success and changed nothing.
        data: sql`jsonb_set(${entries.data}, ${`{${field}}`}::text[], ${JSON.stringify(to)}::jsonb, true)`,
        updatedAt: new Date(),
      })
      .where(and(eq(entries.siteId, this.scope.siteId), eq(entries.id, entryId)));
  }

  /** The runs an owner can see, newest first. */
  async recent(limit = 50): Promise<WorkflowRunRow[]> {
    return this.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.siteId, this.scope.siteId))
      .orderBy(sql`${workflowRuns.createdAt} desc`)
      .limit(limit);
  }
}

/** Does this workflow care about this event? */
export function fires(workflow: Workflow, event: TriggerEvent): boolean {
  const trigger = workflow.trigger;
  if (trigger.on !== event.on) return false;

  switch (trigger.on) {
    case "entry.created":
    case "entry.updated":
      return trigger.type === event.typeKey;
    case "entry.transitioned":
      return (
        trigger.type === event.typeKey && (trigger.to === undefined || trigger.to === event.to)
      );
    case "payment.succeeded":
      return trigger.type === undefined || trigger.type === event.typeKey;
    default:
      return false;
  }
}
