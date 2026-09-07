/**
 * Building an automation (ADR 0030).
 *
 * The surgery, without a database: what each edit does to the spec, what it
 * refuses, and that a refused edit leaves the caller's spec untouched. What
 * happens after — the diff, the gate, the patch — is tested where it lives.
 */
import { describe, expect, it } from "vitest";
import { SiteSpec, type Workflow } from "@forinda-cms/spec";

import { ApplySpecUseCase } from "../use-cases/apply-spec.usecase";
import { AutomationEditUseCase } from "../use-cases/automation-edit.usecase";

const spec = SiteSpec.parse({
  specVersion: 2,
  name: "Riverside Salon",
  theme: { colors: { brand: "#1a7f5a" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
  wiring: [{ key: "crm", kind: "webhook", config: { url: "https://crm.example/hook" } }],
  content: [
    {
      key: "booking",
      label: "Booking",
      fields: [
        { name: "reference", label: "Reference", type: "text" },
        {
          name: "status",
          label: "Status",
          type: "state",
          initial: "pending",
          values: ["pending", "confirmed"],
          transitions: [{ from: "pending", to: ["confirmed"] }],
        },
      ],
    },
  ],
  pages: [],
  logic: [
    {
      key: "tell-the-owner",
      trigger: { on: "entry.created", type: "booking" },
      steps: [{ action: "webhook.post", params: { to: "crm" } }],
    },
  ],
});

function editor() {
  const applied: SiteSpec[] = [];
  const apply = Object.assign(Object.create(ApplySpecUseCase.prototype) as ApplySpecUseCase, {
    execute: async (next: SiteSpec) => {
      applied.push(next);
      return { seq: applied.length, changes: [], migration: [] };
    },
  });
  return { edits: new AutomationEditUseCase(apply), applied };
}

const INPUT = { actor: "owner@example.test" };
const trigger = { on: "entry.created", type: "booking" } as Workflow["trigger"];

describe("creating one", () => {
  it("starts with a step, so it is something rather than a name", async () => {
    const { edits, applied } = editor();
    expect(await edits.create(spec, "tell-the-kitchen", trigger, INPUT)).toEqual({
      ok: true,
      seq: 1,
    });

    const made = applied[0]!.logic.find((w) => w.key === "tell-the-kitchen")!;
    expect(made.steps).toHaveLength(1);
    expect(made.trigger).toEqual(trigger);
  });

  it("refuses a name that is taken, or one that is not a key", async () => {
    const { edits, applied } = editor();
    expect(await edits.create(spec, "tell-the-owner", trigger, INPUT)).toEqual({
      ok: false,
      error: 'There is already an automation called "tell-the-owner".',
    });
    expect((await edits.create(spec, "Tell The Owner", trigger, INPUT)).ok).toBe(false);
    expect(applied).toHaveLength(0);
  });
});

describe("steps", () => {
  it("adds one from the registry", async () => {
    const { edits, applied } = editor();
    await edits.addStep(spec, "tell-the-owner", "entry.transition", INPUT);

    expect(applied[0]!.logic[0]!.steps.map((s) => s.action)).toEqual([
      "webhook.post",
      "entry.transition",
    ]);
  });

  it("fills a required parameter, so the step it adds is already valid", async () => {
    // Every applied spec has to be valid, and a builder where "add a step" and
    // "configure it" are two applies would have the first one refused. The
    // value is a real choice the panel then shows.
    const { edits, applied } = editor();
    await edits.addStep(spec, "tell-the-owner", "entry.transition", INPUT);

    expect(applied[0]!.logic[0]!.steps[1]).toEqual({
      action: "entry.transition",
      params: { to: "pending" },
    });
  });

  it("refuses a step it cannot fill, rather than adding one that cannot run", async () => {
    const { edits, applied } = editor();
    const noWebhook = SiteSpec.parse({ ...spec, wiring: [] });

    expect(await edits.addStep(noWebhook, "tell-the-owner", "webhook.post", INPUT)).toEqual({
      ok: false,
      error: "This site has no webhook to send to yet — declare one first.",
    });
    expect(applied).toHaveLength(0);
  });

  it("keeps at least one, because a trigger that does nothing is not an automation", async () => {
    const { edits, applied } = editor();
    expect(await edits.removeStep(spec, "tell-the-owner", 0, INPUT)).toEqual({
      ok: false,
      error: "An automation needs at least one step.",
    });
    expect(applied).toHaveLength(0);
  });

  it("writes a step's parameters, and clears one that was emptied", async () => {
    const { edits, applied } = editor();
    await edits.setStep(
      spec,
      "tell-the-owner",
      0,
      { stepKey: "told", params: { to: "crm" } },
      INPUT,
    );

    expect(applied[0]!.logic[0]!.steps[0]).toMatchObject({ key: "told", params: { to: "crm" } });

    // Assigned rather than merged: the panel submits every field it shows, so a
    // merge would make clearing impossible.
    await edits.setStep(applied[0]!, "tell-the-owner", 0, { stepKey: "", params: {} }, INPUT);
    expect(applied[1]!.logic[0]!.steps[0]).toEqual({ action: "webhook.post" });
  });

  it("refuses a step index that is gone rather than writing somewhere else", async () => {
    const { edits, applied } = editor();
    expect((await edits.setStep(spec, "tell-the-owner", 9, { params: {} }, INPUT)).ok).toBe(false);
    expect((await edits.moveStep(spec, "tell-the-owner", 0, -1, INPUT)).ok).toBe(false);
    expect(applied).toHaveLength(0);
  });
});

describe("turning one off", () => {
  it("keeps it, so it can be turned back on", async () => {
    const { edits, applied } = editor();
    await edits.setEnabled(spec, "tell-the-owner", false, INPUT);

    expect(applied[0]!.logic[0]!.enabled).toBe(false);
    expect(applied[0]!.logic).toHaveLength(1);
  });

  it("leaves the caller's spec untouched, whatever happens", async () => {
    const { edits } = editor();
    await edits.setEnabled(spec, "tell-the-owner", false, INPUT);
    await edits.removeStep(spec, "tell-the-owner", 0, INPUT);

    expect(spec.logic[0]!.enabled).toBe(true);
    expect(spec.logic[0]!.steps).toHaveLength(1);
  });
});
