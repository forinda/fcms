/**
 * Entry validation tests.
 *
 * This is the layer doc 03 §2 accepted as the cost of choosing `jsonb` over
 * EAV — Postgres enforces nothing inside the column, so anything wrong here is
 * wrong in the database. The cases below are the ones a form actually produces.
 */
import { describe, expect, it } from "vitest";

import { ContentType } from "./content.js";
import { coerceEntryInput, validateEntry } from "./entry.js";

const service = ContentType.parse({
  key: "service",
  label: "Service",
  fields: [
    { name: "name", label: "Name", type: "text", required: true },
    { name: "blurb", label: "Blurb", type: "text" },
    { name: "price", label: "Price", type: "number", required: true, min: 0 },
    { name: "email", label: "Email", type: "email" },
    { name: "active", label: "Active", type: "boolean" },
    {
      name: "tier",
      label: "Tier",
      type: "select",
      options: [
        { value: "basic", label: "Basic" },
        { value: "premium", label: "Premium" },
      ],
    },
  ],
});

describe("what an HTML form actually sends", () => {
  it("coerces a numeric string into a number", () => {
    const r = validateEntry(service, { name: "Cut", price: "1500" });
    expect(r.ok).toBe(true);
    expect(r.data?.["price"]).toBe(1500);
  });

  it("treats an unchecked box as false rather than missing", () => {
    // A checkbox sends nothing when unchecked. Absent has to mean false, or
    // every unchecked toggle reads as "not answered".
    expect(coerceEntryInput(service, { name: "Cut", price: "1" })["active"]).toBe(false);
    expect(coerceEntryInput(service, { active: "on" })["active"]).toBe(true);
  });

  it("treats an empty optional field as absent, not as an empty value", () => {
    // Otherwise every optional email field fails its own type on an empty form.
    const r = validateEntry(service, { name: "Cut", price: "1", blurb: "", email: "" });
    expect(r.ok).toBe(true);
    expect(r.data?.["blurb"]).toBeUndefined();
  });
});

describe("what it refuses", () => {
  it("requires the required fields, and says which", () => {
    const r = validateEntry(service, { blurb: "no name or price" });
    expect(r.ok).toBe(false);
    // Keyed by field, so a form shows each message where it belongs.
    expect(Object.keys(r.errors!)).toEqual(expect.arrayContaining(["name", "price"]));
  });

  it("rejects a field nobody declared", () => {
    // A silently-accepted extra key is how a typo becomes invisible data that
    // no form shows and no migration knows about.
    const r = validateEntry(service, { name: "Cut", price: "1", colour: "red" });
    expect(r.ok).toBe(false);
  });

  it("enforces a field's own constraints", () => {
    expect(validateEntry(service, { name: "Cut", price: "-5" }).ok).toBe(false);
    expect(validateEntry(service, { name: "Cut", price: "1", email: "nope" }).ok).toBe(false);
    expect(validateEntry(service, { name: "Cut", price: "1", tier: "gold" }).ok).toBe(false);
  });

  it("accepts a declared option", () => {
    expect(validateEntry(service, { name: "Cut", price: "1", tier: "premium" }).ok).toBe(true);
  });
});

describe("state and structured field types", () => {
  const booking = ContentType.parse({
    key: "booking",
    label: "Booking",
    fields: [
      {
        name: "status",
        label: "Status",
        type: "state",
        initial: "pending",
        values: ["pending", "confirmed"],
        transitions: [{ from: "pending", to: ["confirmed"] }],
      },
      { name: "hours", label: "Hours", type: "hours" },
    ],
  });

  it("only accepts a declared state", () => {
    expect(validateEntry(booking, { status: "confirmed" }).ok).toBe(true);
    expect(validateEntry(booking, { status: "invented" }).ok).toBe(false);
  });

  it("validates working hours structurally rather than as opaque JSON", () => {
    // The reason `hours` is a field type at all instead of a generic `json`
    // escape hatch (ADR 0014, findings 7).
    expect(validateEntry(booking, { hours: { mon: [{ from: "09:00", to: "17:00" }] } }).ok).toBe(
      true,
    );
    expect(validateEntry(booking, { hours: "whenever" }).ok).toBe(false);
  });
});
