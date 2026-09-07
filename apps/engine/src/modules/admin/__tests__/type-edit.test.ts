/**
 * Building a content type (ADR 0033).
 *
 * The surgery, without a database: what each edit does to the spec, what it
 * refuses, and that a refused edit leaves the caller's spec untouched. The
 * diff, the gate and the migration are tested where they live.
 */
import { describe, expect, it } from "vitest";
import { SiteSpec } from "@forinda-cms/spec";

import { ApplySpecUseCase } from "../use-cases/apply-spec.usecase";
import { TypeEditUseCase } from "../use-cases/type-edit.usecase";

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
      fields: [
        { name: "name", label: "Name", type: "text", required: true },
        { name: "price", label: "Price", type: "number" },
        {
          name: "rating",
          label: "Rating",
          type: "aggregate",
          of: "review",
          on: "service",
          field: "score",
          fn: "avg",
        },
      ],
    },
    {
      key: "review",
      label: "Review",
      fields: [
        { name: "score", label: "Score", type: "number" },
        { name: "service", label: "Service", type: "reference", to: "service" },
      ],
    },
  ],
  pages: [],
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
  return { edits: new TypeEditUseCase(apply), applied };
}

const INPUT = { actor: "owner@example.test" };
const typeIn = (s: SiteSpec, key: string) => s.content.find((t) => t.key === key)!;
const fieldIn = (s: SiteSpec, key: string, name: string) =>
  typeIn(s, key).fields.find((f) => f.name === name) as Record<string, unknown> | undefined;

describe("adding a type", () => {
  it("starts with a title field, because a type with none is not a valid spec", async () => {
    const { edits, applied } = editor();
    expect(await edits.create(spec, "product", "Product", "Products", INPUT)).toEqual({
      ok: true,
      seq: 1,
    });

    const made = typeIn(applied[0]!, "product");
    expect(made.fields).toHaveLength(1);
    expect(made.titleField).toBe("title");
    expect(made.labelPlural).toBe("Products");
  });

  it("refuses a key that is already taken", async () => {
    const { edits, applied } = editor();
    expect(await edits.create(spec, "service", "Service", "", INPUT)).toEqual({
      ok: false,
      error: 'There is already a type called "service".',
    });
    expect(applied).toHaveLength(0);
  });

  it("refuses a key that is not a key", async () => {
    const { edits } = editor();
    const result = await edits.create(spec, "Menu Item", "Menu item", "", INPUT);
    expect(result).toEqual({ ok: false, error: "Use lowercase words joined by -." });
  });
});

describe("adding a field", () => {
  it("is valid the moment it is added", async () => {
    const { edits, applied } = editor();
    expect(await edits.addField(spec, "service", "category", "Category", "select", INPUT)).toEqual({
      ok: true,
      seq: 1,
    });

    // A select with no options is not a spec that parses, so "add" and
    // "configure" cannot be two applies.
    expect(fieldIn(applied[0]!, "service", "category")?.["options"]).toEqual([
      { value: "first-choice", label: "First choice" },
    ]);
  });

  it("points a new reference at something that exists", async () => {
    const { edits, applied } = editor();
    await edits.addField(spec, "service", "topReview", "Top review", "reference", INPUT);
    expect(fieldIn(applied[0]!, "service", "topReview")?.["to"]).toBe("review");
  });

  it("refuses a name that is not camelCase", async () => {
    const { edits, applied } = editor();
    expect(await edits.addField(spec, "service", "top-review", "Top", "text", INPUT)).toEqual({
      ok: false,
      error: "Field names are camelCase, starting with a lowercase letter.",
    });
    expect(applied).toHaveLength(0);
  });

  it("refuses a name the type already has", async () => {
    const { edits } = editor();
    expect(await edits.addField(spec, "service", "price", "Price", "number", INPUT)).toEqual({
      ok: false,
      error: '"Service" already has a field called "price".',
    });
  });
});

describe("editing a field", () => {
  it("keeps everything the form has no control for", async () => {
    const { edits, applied } = editor();
    expect(
      await edits.updateField(spec, "service", "rating", { label: "Average rating" }, INPUT),
    ).toEqual({ ok: true, seq: 1 });

    const rating = fieldIn(applied[0]!, "service", "rating")!;
    expect(rating["label"]).toBe("Average rating");
    // An aggregate's source has no control on the screen. A field that was
    // rebuilt from the form rather than merged onto would have lost it.
    expect(rating["of"]).toBe("review");
    expect(rating["fn"]).toBe("avg");
  });

  it("reads choices as lines, and lets one label itself", async () => {
    const { edits, applied } = editor();
    await edits.addField(spec, "service", "category", "Category", "select", INPUT);
    await edits.updateField(
      applied[0]!,
      "service",
      "category",
      { label: "Category", options: "hair: Hair\nspa" },
      INPUT,
    );

    expect(fieldIn(applied[1]!, "service", "category")?.["options"]).toEqual([
      { value: "hair", label: "Hair" },
      { value: "spa", label: "spa" },
    ]);
  });

  it("refuses a status that starts somewhere it cannot be", async () => {
    const { edits, applied } = editor();
    await edits.addField(spec, "service", "state", "State", "state", INPUT);
    expect(
      await edits.updateField(
        applied[0]!,
        "service",
        "state",
        { label: "State", values: "new\ndone", initial: "elsewhere", transitions: "new: done" },
        INPUT,
      ),
    ).toEqual({
      ok: false,
      error: '"elsewhere" is not one of the values, so nothing could start there.',
    });
  });

  it("refuses a move between values that do not exist", async () => {
    const { edits, applied } = editor();
    await edits.addField(spec, "service", "state", "State", "state", INPUT);
    expect(
      await edits.updateField(
        applied[0]!,
        "service",
        "state",
        { label: "State", values: "new\ndone", initial: "new", transitions: "new: elsewhere" },
        INPUT,
      ),
    ).toEqual({ ok: false, error: '"elsewhere" is not one of the values.' });
  });

  it("clears an optional setting rather than blanking it", async () => {
    const { edits, applied } = editor();
    await edits.update(
      spec,
      "service",
      { label: "Service", permalink: "/services/{{ entry.slug }}", publishable: true },
      INPUT,
    );
    await edits.update(applied[0]!, "service", { label: "Service", publishable: true }, INPUT);

    // `permalink: ""` is not a spec that parses — an empty box has to delete
    // the key, not write an empty string into it.
    expect(typeIn(applied[0]!, "service").permalink).toBe("/services/{{ entry.slug }}");
    expect(typeIn(applied[1]!, "service").permalink).toBeUndefined();
  });
});

describe("removing", () => {
  it("drops the title with the field it named", async () => {
    const { edits, applied } = editor();
    expect(await edits.removeField(spec, "service", "name", INPUT)).toEqual({ ok: true, seq: 1 });

    // Left behind, `titleField: "name"` names a field that is gone, and the
    // schema's refusal for that reads worse than the one this avoids.
    expect(typeIn(applied[0]!, "service").titleField).toBeUndefined();
  });

  it("keeps a type from becoming fieldless", async () => {
    const { edits } = editor();
    const one = SiteSpec.parse({
      ...spec,
      content: [
        { key: "note", label: "Note", fields: [{ name: "body", label: "Body", type: "text" }] },
      ],
    });
    expect(await edits.removeField(one, "note", "body", INPUT)).toEqual({
      ok: false,
      error: "A type needs at least one field.",
    });
  });

  it("leaves the caller's spec untouched when it refuses", async () => {
    const { edits } = editor();
    const before = JSON.stringify(spec);
    await edits.removeField(spec, "service", "nothing", INPUT);
    await edits.addField(spec, "service", "price", "Price", "number", INPUT);
    expect(JSON.stringify(spec)).toBe(before);
  });

  it("keeps the last type", async () => {
    const { edits } = editor();
    const one = SiteSpec.parse({
      ...spec,
      content: [
        { key: "note", label: "Note", fields: [{ name: "body", label: "Body", type: "text" }] },
      ],
    });
    expect(await edits.remove(one, "note", INPUT)).toEqual({
      ok: false,
      error: "A site needs at least one content type.",
    });
  });
});

describe("moving a field", () => {
  it("swaps it with its neighbour", async () => {
    const { edits, applied } = editor();
    expect(await edits.moveField(spec, "service", 1, -1, INPUT)).toEqual({ ok: true, seq: 1 });
    expect(typeIn(applied[0]!, "service").fields.map((f) => f.name)).toEqual([
      "price",
      "name",
      "rating",
    ]);
  });

  it("says so at the end rather than reordering nothing", async () => {
    const { edits, applied } = editor();
    expect(await edits.moveField(spec, "service", 0, -1, INPUT)).toEqual({
      ok: false,
      error: "That field is already at the end.",
    });
    expect(applied).toHaveLength(0);
  });
});
