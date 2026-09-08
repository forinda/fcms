/**
 * The dashboard's one piece of judgement: what counts as needing a person.
 *
 * Everything else on the screen is a list of what exists. This is the part that
 * can be wrong in a way nobody notices — a site quietly failing every ten
 * minutes while the top of the screen says all is well.
 */
import { describe, expect, it } from "vitest";
import { SiteSpec } from "@forinda-cms/spec";
import type { PaymentRow, WorkflowRunRow } from "@forinda-cms/db";

import { dashboard } from "../utils/dashboard.view";

const spec = SiteSpec.parse({
  specVersion: 2,
  name: "Riverside Salon",
  theme: { colors: { brand: "#1a7f5a" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
  content: [
    {
      key: "booking",
      label: "Booking",
      labelPlural: "Bookings",
      fields: [{ name: "reference", label: "Reference", type: "text" }],
    },
  ],
  pages: [],
  logic: [
    {
      key: "tell-the-owner",
      trigger: { on: "entry.created", type: "booking" },
      steps: [{ action: "webhook.post", params: {} }],
    },
  ],
});

const run = (status: string): WorkflowRunRow =>
  ({
    workflowKey: "tell-the-owner",
    status,
    trigger: "entry.created",
    attempts: 1,
    lastError: null,
    detail: null,
    createdAt: new Date(),
  }) as WorkflowRunRow;

const payment = (status: string): PaymentRow =>
  ({ status, typeKey: "booking", createdAt: new Date() }) as PaymentRow;

const view = (over: Partial<Parameters<typeof dashboard>[0]> = {}) =>
  dashboard({
    spec,
    counts: { booking: 11 },
    drafts: {},
    runs: [],
    payments: [],
    history: [],
    ...over,
  });

describe("what needs a person", () => {
  it("says so plainly when nothing does", () => {
    expect(view()).toContain("Nothing is waiting");
  });

  it("counts drafts in the type's own words", () => {
    expect(view({ drafts: { booking: 8 } })).toContain("<strong>8</strong> bookings not published");
    expect(view({ drafts: { booking: 1 } })).toContain("<strong>1</strong> booking not published");
  });

  it("names a failed run, and does not claim all is well beside it", () => {
    const html = view({ runs: [run("failed"), run("done")] });
    expect(html).toContain("<strong>1</strong> automation run failed");
    expect(html).not.toContain("Nothing is waiting");
  });

  it("ignores runs that worked", () => {
    expect(view({ runs: [run("done"), run("done")] })).toContain("Nothing is waiting");
  });

  it("counts a payment that was started and never finished", () => {
    const html = view({ payments: [payment("pending"), payment("paid")] });
    expect(html).toContain("started and never finished");
    expect(html).toContain("<strong>1</strong>");
  });

  it("mentions an automation somebody turned off", () => {
    const paused = SiteSpec.parse({
      ...spec,
      logic: [{ ...spec.logic[0]!, enabled: false }],
    });
    expect(view({ spec: paused })).toContain("automation is turned off");
  });
});
