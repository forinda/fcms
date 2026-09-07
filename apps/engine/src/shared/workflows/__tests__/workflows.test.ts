/**
 * The workflow runner (ADR 0024).
 *
 * Against a real database, because the properties that matter are all about the
 * queue: a run is enqueued by an event and not executed inside it, a failure
 * retries and then stops somewhere an owner can see, and two runners never take
 * the same row.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  closeAllPools,
  createDb,
  entries,
  organizations,
  sites,
  workflowRuns,
} from "@forinda-cms/db";
import { SiteSpec } from "@forinda-cms/spec";

import { WorkflowUseCase, fires } from "../workflow.usecase";
import { reachable } from "../actions";

const url = process.env["DATABASE_URL"];
const suite = url ? describe : describe.skip;
const db = url ? createDb(url) : (undefined as never);

const ORG = "org_workflows";
const SITE = "site_workflows";
const scope = { orgId: ORG, siteId: SITE };

const spec = (steps: unknown[], trigger: unknown = { on: "entry.created", type: "booking" }) =>
  SiteSpec.parse({
    specVersion: 2,
    name: "Riverside Salon",
    theme: { colors: { brand: "#1a7f5a" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
    wiring: [{ key: "crm", kind: "webhook", config: { url: "https://crm.example/hook" } }],
    content: [
      {
        key: "booking",
        label: "Booking",
        fields: [
          { name: "customerName", label: "Name", type: "text" },
          {
            name: "status",
            label: "Status",
            type: "state",
            initial: "pending",
            values: ["pending", "confirmed", "cancelled"],
            transitions: [{ from: "pending", to: ["confirmed", "cancelled"] }],
          },
        ],
      },
    ],
    pages: [],
    logic: [{ key: "on-booking", trigger, steps }],
  });

suite("workflows", () => {
  let use: WorkflowUseCase;
  let entryId: string;

  beforeEach(async () => {
    await db.delete(workflowRuns);
    await db.delete(entries).where(eq(entries.siteId, SITE));
    await db.delete(sites).where(eq(sites.orgId, ORG));
    await db.delete(organizations).where(eq(organizations.id, ORG));

    await db.insert(organizations).values({ id: ORG, name: "Workflows org" });
    await db.insert(sites).values({ id: SITE, orgId: ORG, slug: "salon", name: "Salon" });
    const [entry] = await db
      .insert(entries)
      .values({
        siteId: SITE,
        orgId: ORG,
        typeKey: "booking",
        data: { customerName: "Amina", status: "pending" },
        status: "draft",
      })
      .returning();
    entryId = entry!.id;

    use = new WorkflowUseCase(db, scope);
  });

  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    if (url) await closeAllPools();
  });

  // A function, not a value: `entryId` is assigned in `beforeEach`, and a
  // constant here captured `undefined` — every run then had no entry and every
  // action skipped, while the run itself reported success.
  const event = () => ({ on: "entry.created" as const, typeKey: "booking", entryId });

  describe("what a trigger matches", () => {
    const workflow = (trigger: unknown) =>
      spec([{ action: "webhook.post", params: { to: "crm" } }], trigger).logic[0]!;

    it("matches its own type and nothing else", () => {
      expect(fires(workflow({ on: "entry.created", type: "booking" }), event())).toBe(true);
      expect(fires(workflow({ on: "entry.created", type: "review" }), event())).toBe(false);
      expect(fires(workflow({ on: "entry.updated", type: "booking" }), event())).toBe(false);
    });

    it("narrows a transition to one state when it names one", () => {
      const moved = {
        on: "entry.transitioned" as const,
        typeKey: "booking",
        entryId,
        to: "confirmed",
      };
      expect(
        fires(workflow({ on: "entry.transitioned", type: "booking", to: "confirmed" }), moved),
      ).toBe(true);
      expect(
        fires(workflow({ on: "entry.transitioned", type: "booking", to: "cancelled" }), moved),
      ).toBe(false);
      // Without a `to`, any transition of that type fires it.
      expect(fires(workflow({ on: "entry.transitioned", type: "booking" }), moved)).toBe(true);
    });
  });

  describe("running", () => {
    it("queues on the event and runs on the tick, not in between", async () => {
      const posted: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (to: string) => {
          posted.push(to);
          return { ok: true, status: 200 };
        }),
      );

      const queued = await use.enqueue(
        spec([{ action: "webhook.post", params: { to: "crm" } }]),
        event(),
      );
      expect(queued).toBe(1);
      // Nothing has run yet: the write returned before the automation did
      // anything at all.
      expect(posted).toEqual([]);

      const [run] = await use.runDue(spec([{ action: "webhook.post", params: { to: "crm" } }]));
      expect(run!.status).toBe("done");
      expect(posted).toEqual(["https://crm.example/hook"]);
      expect(run!.detail).toMatchObject({ steps: ["webhook.post: posted to crm (200)"] });
    });

    it("moves an entry along a declared transition", async () => {
      const moving = spec([{ action: "entry.transition", params: { to: "confirmed" } }]);
      await use.enqueue(moving, event());
      const [run] = await use.runDue(moving);

      expect(run!.status).toBe("done");
      const [row] = await db.select().from(entries).where(eq(entries.id, entryId));
      expect((row!.data as Record<string, unknown>)["status"]).toBe("confirmed");
    });

    it("refuses a transition the type does not declare", async () => {
      await db
        .update(entries)
        .set({ data: { customerName: "Amina", status: "confirmed" } })
        .where(eq(entries.id, entryId));

      // `confirmed → confirmed` is fine, but nothing goes back to pending: the
      // declared transitions are the point of a state field.
      const backwards = spec([{ action: "entry.transition", params: { to: "pending" } }]);
      await use.enqueue(backwards, event());
      const [run] = await use.runDue(backwards);

      expect(run!.status).toBe("pending"); // queued for retry
      expect(run!.lastError).toMatch(/cannot go from confirmed to pending/);
    });

    it("retries a failure with a backoff, then stops somewhere an owner can read", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: false, status: 502 })),
      );
      const failing = spec([{ action: "webhook.post", params: { to: "crm" } }]);
      await use.enqueue(failing, event());

      // Attempt 1: queued again, in the future.
      const [first] = await use.runDue(failing);
      expect(first!.status).toBe("pending");
      expect(first!.attempts).toBe(1);
      expect(first!.runAt.getTime()).toBeGreaterThan(Date.now());

      // Nothing is due, so a tick does not spin on it.
      expect(await use.runDue(failing)).toEqual([]);

      // Four more attempts and it gives up with the reason on the row.
      for (let attempt = 2; attempt <= 5; attempt += 1) {
        await db
          .update(workflowRuns)
          .set({ runAt: new Date(0) })
          .where(eq(workflowRuns.status, "pending"));
        const [row] = await use.runDue(failing);
        if (attempt < 5) expect(row!.status).toBe("pending");
        else {
          expect(row!.status).toBe("failed");
          expect(row!.lastError).toMatch(/502/);
        }
      }
    });

    it("does not retry a refusal the far end will keep refusing", async () => {
      // A 400 will not become a 200 by being sent again.
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: false, status: 400 })),
      );
      const rejected = spec([{ action: "webhook.post", params: { to: "crm" } }]);
      await use.enqueue(rejected, event());

      const [run] = await use.runDue(rejected);
      expect(run!.status).toBe("done");
      expect(run!.detail).toMatchObject({ steps: ["webhook.post: posted to crm (400)"] });
    });

    it("skips a step whose `when` does not match this row", async () => {
      const conditional = spec([
        {
          action: "webhook.post",
          params: { to: "crm" },
          when: { field: "customerName", op: "eq", value: "Someone else" },
        },
      ]);
      const fetched = vi.fn();
      vi.stubGlobal("fetch", fetched);

      await use.enqueue(conditional, event());
      const [run] = await use.runDue(conditional);

      expect(run!.status).toBe("done");
      expect(fetched).not.toHaveBeenCalled();
    });
  });

  describe("schedules", () => {
    const nightly = (cron: string) =>
      spec([{ action: "webhook.post", params: { to: "crm" } }], { on: "schedule", cron });

    it("queues a workflow that is due this minute, once", async () => {
      const at = new Date("2026-09-07T09:30:00Z");
      expect(await use.enqueueDue(nightly("30 9 * * *"), at)).toBe(1);
      // A second instance ticking the same minute adds nothing — the unique
      // index decides rather than a lock somebody remembers to take.
      expect(await use.enqueueDue(nightly("30 9 * * *"), at)).toBe(0);
      expect(await use.enqueueDue(nightly("30 9 * * *"), new Date("2026-09-08T09:30:00Z"))).toBe(1);
    });

    it("queues nothing when it is not due", async () => {
      expect(await use.enqueueDue(nightly("30 9 * * *"), new Date("2026-09-07T09:31:00Z"))).toBe(0);
    });
  });

  describe("where a webhook may post", () => {
    it("refuses the addresses that make this a server-side request forgery", () => {
      expect(reachable("https://crm.example/hook")).toBe(true);
      expect(reachable("http://localhost:8800/admin")).toBe(false);
      expect(reachable("http://127.0.0.1/")).toBe(false);
      expect(reachable("http://169.254.169.254/latest/meta-data/")).toBe(false);
      expect(reachable("http://10.0.0.5/")).toBe(false);
      expect(reachable("http://192.168.1.1/")).toBe(false);
      expect(reachable("http://172.16.0.1/")).toBe(false);
      expect(reachable("file:///etc/passwd")).toBe(false);
      expect(reachable("http://[::1]/")).toBe(false);
      expect(reachable("http://[fd00::1]/")).toBe(false);
      expect(reachable("http://100.64.0.1/")).toBe(false);
      expect(reachable("http://hooks.slack.com/services/x")).toBe(true);
      expect(reachable("not a url")).toBe(false);
    });
  });
});
