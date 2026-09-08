/**
 * Building a customer's journey (ADR 0040).
 *
 * The rule that matters here: a step's choice has to land on a field of the
 * thing the journey creates. A journey whose steps collect answers nowhere runs
 * perfectly, finishes, and writes an entry with the fields blank — the "looks
 * configured, does nothing" failure with four screens in front of it.
 */
import { describe, expect, it } from "vitest";
import { SiteSpec } from "@forinda-cms/spec";

import { ApplySpecUseCase } from "../use-cases/apply-spec.usecase";
import { FlowEditUseCase, targetOf } from "../use-cases/flow-edit.usecase";

const spec = SiteSpec.parse({
  specVersion: 2,
  name: "Riverside Salon",
  theme: { colors: { brand: "#1a7f5a" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
  content: [
    {
      key: "service",
      label: "Service",
      labelPlural: "Services",
      titleField: "name",
      fields: [{ name: "name", label: "Name", type: "text", required: true }],
    },
    {
      key: "staff",
      label: "Stylist",
      titleField: "name",
      fields: [{ name: "name", label: "Name", type: "text", required: true }],
    },
    {
      key: "booking",
      label: "Booking",
      submissions: "anyone",
      titleField: "customerName",
      fields: [
        { name: "customerName", label: "Your name", type: "text", required: true },
        { name: "service", label: "Service", type: "reference", to: "service" },
        { name: "stylist", label: "Stylist", type: "reference", to: "staff" },
      ],
    },
  ],
  pages: [
    {
      key: "book",
      path: "/book",
      title: "Book",
      blocks: [{ type: "heading", attrs: { text: "Book" } }],
    },
  ],
  logic: [],
});

function editor() {
  const applied: SiteSpec[] = [];
  const apply = Object.assign(Object.create(ApplySpecUseCase.prototype) as ApplySpecUseCase, {
    execute: async (next: SiteSpec) => {
      applied.push(next);
      return { seq: applied.length, changes: [], migration: [] };
    },
  });
  return { edits: new FlowEditUseCase(apply), applied };
}

const INPUT = { actor: "owner@example.test", role: "owner" as const };
const flowIn = (s: SiteSpec, key = "booking") =>
  s.pages.find((p) => p.key === "book")!.flows!.find((f) => f.key === key)!;

/** A site with the journey the other cases then edit. */
async function started() {
  const { edits, applied } = editor();
  await edits.create(spec, "book", "booking", "service", "booking", INPUT);
  return applied[0]!;
}

describe("starting a journey", () => {
  it("arrives with a choosing step and a confirming step", async () => {
    const flow = flowIn(await started());

    expect(flow.steps.map((s) => s.key)).toEqual(["service", "confirm"]);
    // The schema wants at least two steps, so "create it" and "make it a
    // journey" cannot be two applies.
    expect(flow.steps[0]!.selects).toEqual({ from: "service", as: "service" });
    expect(flow.steps[1]!.requires).toEqual(["service"]);
  });

  it("knows what it creates by reading its own last step", async () => {
    const made = await started();
    expect(targetOf(flowIn(made), made)?.key).toBe("booking");
  });

  it("refuses when the choice would land nowhere", async () => {
    const { edits, applied } = editor();
    // A booking has no field pointing at a booking, so the step would collect
    // an answer and write it nowhere.
    const result = await edits.create(spec, "book", "self", "booking", "booking", INPUT);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("written nowhere");
    expect(applied).toHaveLength(0);
  });
});

describe("steps", () => {
  it("goes in before the step that confirms, and rewires what follows", async () => {
    const made = await started();
    const { edits, applied } = editor();

    expect(await edits.addStep(made, "book", "booking", "staff", INPUT)).toEqual({
      ok: true,
      seq: 1,
    });
    const flow = flowIn(applied[0]!);
    expect(flow.steps.map((s) => s.key)).toEqual(["service", "staff", "confirm"]);
    expect(flow.steps[2]!.requires).toEqual(["staff"]);
  });

  it("replaces the choices when the step's source changes", async () => {
    const made = await started();
    const { edits, applied } = editor();

    await edits.updateStep(
      made,
      "book",
      "booking",
      "service",
      { label: "Who", from: "staff", as: "stylist" },
      INPUT,
    );
    const step = flowIn(applied[0]!).steps[0]!;

    expect(step.selects).toEqual({ from: "staff", as: "stylist" });
    // Otherwise the step says "choose a stylist" over a list of services.
    expect(JSON.stringify(step.blocks)).toContain('"from":"staff"');
  });

  it("refuses a field the created type does not have", async () => {
    const made = await started();
    const { edits } = editor();

    expect(
      await edits.updateStep(
        made,
        "book",
        "booking",
        "service",
        { label: "Service", from: "service", as: "nonsense" },
        INPUT,
      ),
    ).toEqual({ ok: false, error: 'Booking has no field called "nonsense".' });
  });

  it("keeps a journey from falling below two steps", async () => {
    const made = await started();
    const { edits } = editor();
    expect(await edits.removeStep(made, "book", "booking", "service", INPUT)).toEqual({
      ok: false,
      error: "A journey needs at least two steps.",
    });
  });

  it("rewires the order after a move, rather than being refused for it", async () => {
    const made = await started();
    const { edits, applied } = editor();
    await edits.addStep(made, "book", "booking", "staff", INPUT);
    await edits.moveStep(applied[0]!, "book", "booking", 0, 1, INPUT);

    const flow = flowIn(applied[1]!);
    expect(flow.steps.map((s) => s.key)).toEqual(["staff", "service", "confirm"]);
    // The schema refuses a step that requires one coming after it, so a move
    // has to fix the chain rather than report it.
    expect(flow.steps[0]!.requires).toBeUndefined();
    expect(flow.steps[1]!.requires).toEqual(["staff"]);
  });
});

describe("removing a journey", () => {
  it("leaves the page without an empty list on it", async () => {
    const made = await started();
    const { edits, applied } = editor();

    expect(await edits.remove(made, "book", "booking", INPUT)).toEqual({ ok: true, seq: 1 });
    expect(applied[0]!.pages.find((p) => p.key === "book")!.flows).toBeUndefined();
  });
});
