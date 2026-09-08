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
  isEmbedded,
  organizations,
  sites,
  workflowRuns,
} from "@forinda-cms/db";
import { SiteSpec } from "@forinda-cms/spec";

import { WorkflowUseCase, fires } from "../workflow.usecase";
import { reachable } from "../actions";

const url = process.env["DATABASE_URL"];
const suite = url ? describe : describe.skip;

/**
 * Is the database inside this process (ADR 0050)?
 *
 * Two tests below fake this process's clock to prove the queue reads the
 * *database's*. Against an embedded Postgres there is only one clock — faking
 * it moves both — so the thing they simulate cannot happen, and neither can the
 * bug they were written for: skew needs two machines to disagree, and there is
 * one. The guarantee holds by construction rather than by asking, so the tests
 * are skipped rather than weakened into something that passes either way.
 */
const embedded = url ? isEmbedded(url) : false;
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

  describe("when a run is due", () => {
    it.skipIf(embedded)("is decided by the database's clock, not this process's", async () => {
      // The CI failure this fixes: `runAt` is stamped by the database on
      // insert, so comparing it against a `Date` from here means two clocks
      // decide, and a database a few milliseconds ahead makes a row that was
      // just enqueued invisible. Locally both clocks are the same one.
      const pipeline = spec([{ action: "entry.transition", params: { to: "confirmed" } }]);
      await use.enqueue(pipeline, event());

      // The whole process five seconds behind the database — `shouldAdvanceTime`
      // so awaited work still runs.
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date(Date.now() - 5_000));
      try {
        expect(await use.runDue(pipeline)).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
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

  describe("a pipeline", () => {
    const piped = (steps: unknown[], wiring: unknown[] = []) =>
      SiteSpec.parse({
        ...spec([{ action: "webhook.post", params: { to: "crm" } }]),
        wiring: [
          { key: "crm", kind: "webhook", config: { url: "https://crm.example/hook" } },
          { key: "billing", kind: "api", config: { url: "https://billing.example" } },
          ...wiring,
        ],
        logic: [{ key: "on-booking", trigger: { on: "entry.created", type: "booking" }, steps }],
      });

    it("passes what one step produced to the next", async () => {
      const posted: unknown[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: { body?: string }) => {
          posted.push({ url, body: init?.body });
          return { ok: true, status: 200, text: async () => JSON.stringify({ id: "cus_42" }) };
        }),
      );

      const pipeline = piped([
        { key: "customer", action: "http.request", params: { to: "billing", path: "/customers" } },
        { action: "webhook.post", params: { to: "crm", note: "{{ steps.customer.body.id }}" } },
      ]);

      await use.enqueue(pipeline, event());
      const [run] = await use.runDue(pipeline);

      expect(run!.status).toBe("done");
      expect(run!.detail).toMatchObject({
        steps: [
          "customer: called GET https://billing.example/customers (200)",
          "webhook.post: posted to crm (200)",
        ],
      });
    });

    it("resolves a parameter against the entry that triggered it", async () => {
      let sent: Record<string, unknown> = {};
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: { body?: string }) => {
          sent = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
          return { ok: true, status: 200, text: async () => "" };
        }),
      );

      const pipeline = piped([
        {
          key: "call",
          action: "http.request",
          params: { to: "billing", path: "/x", method: "POST", body: "{{ entry.customerName }}" },
        },
      ]);

      await use.enqueue(pipeline, event());
      await use.runDue(pipeline);
      expect(sent).toEqual({});
      // The body is the resolved template, sent as-is.
      expect(vi.mocked(fetch).mock.calls[0]![1]).toMatchObject({ body: "Amina" });
    });

    it("refuses to call an address the integration does not own", async () => {
      const pipeline = piped(
        [{ key: "call", action: "http.request", params: { to: "internal", path: "/" } }],
        [{ key: "internal", kind: "api", config: { url: "http://169.254.169.254" } }],
      );

      await use.enqueue(pipeline, event());
      const [run] = await use.runDue(pipeline);
      expect(run!.lastError).toMatch(/no address this may call/);
    });
  });

  describe("trying one without doing it", () => {
    it("reports what each step would have done, and touches nothing", async () => {
      const fetched = vi.fn();
      vi.stubGlobal("fetch", fetched);

      const pipeline = SiteSpec.parse({
        ...spec([{ action: "webhook.post", params: { to: "crm" } }]),
        logic: [
          {
            key: "on-booking",
            trigger: { on: "entry.created", type: "booking" },
            steps: [
              { action: "entry.transition", params: { to: "confirmed" } },
              { action: "webhook.post", params: { to: "crm" } },
            ],
          },
        ],
      });

      const run = await use.test(pipeline, "on-booking", entryId);

      expect(run!.status).toBe("done");
      expect(run!.detail).toMatchObject({
        test: true,
        steps: [
          "entry.transition: would have moved from pending to confirmed",
          "webhook.post: would have posted to crm",
        ],
      });
      // Nothing left the building, and the row did not move.
      expect(fetched).not.toHaveBeenCalled();
      const [row] = await db.select().from(entries).where(eq(entries.id, entryId));
      expect((row!.data as Record<string, unknown>)["status"]).toBe("pending");
    });
  });

  describe("one automation setting off another", () => {
    const chain = (steps: unknown[], logic: unknown[] = []) =>
      SiteSpec.parse({
        ...spec([{ action: "webhook.post", params: { to: "crm" } }]),
        wiring: [{ key: "crm", kind: "webhook", config: { url: "https://crm.example/hook" } }],
        logic: [
          { key: "on-created", trigger: { on: "entry.created", type: "booking" }, steps },
          ...logic,
        ],
      });

    it("announces a transition an automation made", async () => {
      // "When a booking becomes confirmed, text the customer" means it however
      // the booking became confirmed — and the usual way is another automation.
      const spec_ = chain(
        [{ action: "entry.transition", params: { to: "confirmed" } }],
        [
          {
            key: "on-confirmed",
            trigger: { on: "entry.transitioned", type: "booking", to: "confirmed" },
            steps: [{ action: "webhook.post", params: { to: "crm" } }],
          },
        ],
      );
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: true, status: 200, text: async () => "" })),
      );

      await use.enqueue(spec_, event());
      await use.runDue(spec_);

      const queued = await db.select().from(workflowRuns);
      const followed = queued.find((r) => r.workflowKey === "on-confirmed");
      expect(followed).toBeDefined();
      expect(followed!.detail).toMatchObject({ depth: 1 });
    });

    it("stops a chain rather than filling the queue forever", async () => {
      // Two automations that transition each other is a loop an owner writes by
      // accident, once.
      const loop = chain(
        [{ action: "entry.transition", params: { to: "confirmed" } }],
        [
          {
            key: "back-again",
            trigger: { on: "entry.transitioned", type: "booking" },
            steps: [{ action: "entry.transition", params: { to: "confirmed" } }],
          },
        ],
      );

      await use.enqueue(loop, event());
      for (let round = 0; round < 6; round += 1) {
        await db
          .update(workflowRuns)
          .set({ runAt: new Date(0) })
          .where(eq(workflowRuns.status, "pending"));
        await use.runDue(loop);
      }

      const runs = await db.select().from(workflowRuns);
      const depths = runs.map((r) => (r.detail as { depth?: number } | null)?.depth ?? 0);
      expect(Math.max(...depths)).toBeLessThanOrEqual(3);
      expect(runs.length).toBeLessThan(10);
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

    it.skipIf(embedded)("names the minute the way the database does", async () => {
      // Two instances with skewed clocks either side of a boundary would
      // otherwise compute different dedupe keys, both unique, and a schedule
      // that should run once runs twice. Asked without a time, this reads the
      // database's — so every instance agrees what to call the minute.
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date("2000-01-01T00:00:00Z"));
      try {
        const everyMinute = nightly("* * * * *");
        expect(await use.enqueueDue(everyMinute)).toBe(1);

        const [run] = await db.select().from(workflowRuns);
        // Not the year 2000: the database said what time it is.
        expect(run!.dedupe?.startsWith("2000")).toBe(false);
      } finally {
        vi.useRealTimers();
      }
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
