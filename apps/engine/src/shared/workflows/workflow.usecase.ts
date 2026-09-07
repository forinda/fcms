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
import { matches, resolve } from "@forinda-cms/render";
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

/**
 * How far an automation may set off another one.
 *
 * Three is enough for "the payment confirms the booking, the confirmation texts
 * the customer, the text updates a log" and short of anything that reads like a
 * loop somebody meant.
 */
const MAX_DEPTH = 3;
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
  async enqueue(spec: SiteSpec, event: TriggerEvent, depth = 0): Promise<number> {
    const due = spec.logic.filter((w) => w.enabled !== false && fires(w, event));
    if (due.length === 0) return 0;

    await this.db.insert(workflowRuns).values(
      due.map((w) => ({
        siteId: this.scope.siteId,
        orgId: this.scope.orgId,
        workflowKey: w.key,
        trigger: event.on,
        entryId: event.entryId,
        // How far this is from something a person did, so a chain can stop
        // without a column of its own.
        ...(depth > 0 ? { detail: { depth } } : {}),
      })),
    );
    return due.length;
  }

  /**
   * Queue a run for steps that are not a declared workflow (ADR 0028 §5).
   *
   * A flow's `onComplete` hands to this same registry, so it retries, backs off
   * and appears in the same list of automations — a flow completing is an event
   * with a different name, not a special kind of event. The steps travel on the
   * run because they belong to a page rather than to `logic`.
   */
  async enqueueSteps(
    spec: SiteSpec,
    steps: readonly { action: string; params?: Record<string, unknown> }[],
    about: { typeKey: string; entryId: string; label: string },
  ): Promise<number> {
    if (steps.length === 0) return 0;
    void spec;

    await this.db.insert(workflowRuns).values({
      siteId: this.scope.siteId,
      orgId: this.scope.orgId,
      workflowKey: about.label,
      trigger: "flow.completed",
      entryId: about.entryId,
      detail: { steps: steps.map((s) => s.action), inline: steps },
    });
    return 1;
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
   * Run an automation now, touching nothing (ADR 0029 §5).
   *
   * Every step that reaches the world reports what it would have done instead
   * of doing it, and the result is a run row like any other — marked as a test,
   * on the same screen, with nothing new to learn.
   */
  async test(spec: SiteSpec, workflowKey: string, entryId: string | null) {
    const workflow = spec.logic.find((w) => w.key === workflowKey);
    if (!workflow) return null;

    const [run] = await this.db
      .insert(workflowRuns)
      .values({
        siteId: this.scope.siteId,
        orgId: this.scope.orgId,
        workflowKey,
        trigger: "test",
        entryId,
        status: "running",
        detail: { test: true },
      })
      .returning();

    return this.execute(spec, run!);
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
    // A flow's completion carries its own steps: they belong to a page, not to
    // `logic`, so there is no workflow to look up (ADR 0028 §5).
    const inline = (run.detail as { inline?: Workflow["steps"] } | null)?.inline;
    const workflow =
      spec.logic.find((w) => w.key === run.workflowKey) ??
      (inline ? ({ key: run.workflowKey, steps: inline } as Workflow) : undefined);

    if (!workflow) return this.finish(run, "done", { note: "the automation no longer exists" });

    const entry = run.entryId ? await this.entry(run.entryId) : undefined;
    const type = spec.content.find((t) => t.key === entry?.typeKey);
    const steps: string[] = [];
    const detail = run.detail as { test?: boolean; depth?: number } | null;
    const dryRun = run.status === "testing" || detail?.test === true;
    /** How far this run is from something a person did (ADR 0032, chaining). */
    const depth = detail?.depth ?? 0;

    /**
     * What a parameter's `{{ … }}` sees (ADR 0029 §3).
     *
     * The trigger's entry, the site, and what earlier steps produced. The same
     * evaluator the renderer uses, so there is one template language rather
     * than a second one that grows differently.
     */
    const values: Record<string, unknown> = {
      site: { name: spec.name },
      ...(entry ? { entry: entry.data } : {}),
      steps: {} as Record<string, unknown>,
    };

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

        const params = Object.fromEntries(
          Object.entries(step.params ?? {}).map(([name, value]) => [
            name,
            typeof value === "string" ? resolve(value, values) : value,
          ]),
        );

        const result = await action.run({
          spec,
          entry,
          type,
          params,
          values,
          dryRun,
          setState: (id, field, to) =>
            this.setState(spec, id, entry?.typeKey ?? "", field, to, depth),
        });

        // Named steps publish what they produced; unnamed ones do not, so an
        // automation only grows a key when something reads it.
        if (step.key) {
          (values["steps"] as Record<string, unknown>)[step.key] = result.value ?? {};
        }
        steps.push(`${step.key ?? step.action}: ${result.note}`);
      }
      return this.finish(run, "done", {
        steps,
        ...(dryRun ? { test: true } : {}),
        ...(depth > 0 ? { depth } : {}),
      });
    } catch (error) {
      // A test run does not retry: nobody is waiting five minutes to find out
      // what a preview would have done.
      const message = error instanceof Error ? error.message : String(error);
      return dryRun
        ? this.finish(run, "failed", { steps, test: true }, message)
        : this.retry(run, message, steps);
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
  private async setState(
    spec: SiteSpec,
    entryId: string,
    typeKey: string,
    field: string,
    to: string,
    depth: number,
  ): Promise<void> {
    await this.db
      .update(entries)
      .set({
        // The path is `text[]`, and a bound string is not one — without the cast
        // this ran, reported success and changed nothing.
        data: sql`jsonb_set(${entries.data}, ${`{${field}}`}::text[], ${JSON.stringify(to)}::jsonb, true)`,
        updatedAt: new Date(),
      })
      .where(and(eq(entries.siteId, this.scope.siteId), eq(entries.id, entryId)));

    // Chaining stops somewhere. Two automations that transition each other are
    // a loop an owner writes by accident, and a queue that fills forever is
    // worse than a chain that stops.
    if (depth >= MAX_DEPTH || !typeKey) return;
    await this.enqueue(spec, { on: "entry.transitioned", typeKey, entryId, to }, depth + 1);
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
