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

  it("rejects an empty string in a required text field", () => {
    // What a form sends for a box nobody filled in. Accepting it stored an
    // entry with a blank title and answered 303.
    const result = validateEntry(service, { name: "", price: 1 });
    expect(result.ok).toBe(false);
    expect(result.errors?.["name"]).toBeTruthy();
  });

  it("still treats an empty string as absent in an optional field", () => {
    expect(validateEntry(service, { name: "Cut", price: 1, blurb: "" }).ok).toBe(true);
  });
});

describe("a state field starts where the type says it starts", () => {
  const type = ContentType.parse({
    key: "booking",
    label: "Booking",
    fields: [
      { name: "name", label: "Name", type: "text" },
      {
        name: "status",
        label: "Status",
        type: "state",
        initial: "pending",
        values: ["pending", "confirmed"],
        transitions: [{ from: "pending", to: ["confirmed"] }],
      },
    ],
  });

  it("fills in `initial` when nothing was submitted", () => {
    // Without this the row lands with no status at all, and a workflow that
    // moves it along a transition has nothing to move from.
    const result = validateEntry(type, { name: "Amina" });
    expect(result.ok && result.data!["status"]).toBe("pending");
  });

  it("does not overwrite a state that was given", () => {
    const result = validateEntry(type, { name: "Amina", status: "confirmed" });
    expect(result.ok && result.data!["status"]).toBe("confirmed");
  });

  it("still refuses a state the type does not declare", () => {
    expect(validateEntry(type, { name: "Amina", status: "invented" }).ok).toBe(false);
  });
});

describe("a coordinate", () => {
  const type = ContentType.parse({
    key: "room",
    label: "Room",
    fields: [
      { name: "name", label: "Name", type: "text" },
      { name: "location", label: "Where", type: "geo" },
    ],
  });

  it("takes what a person pastes out of a map", () => {
    const result = validateEntry(type, { name: "Lake house", location: "-0.7167, 36.4333" });
    expect(result.ok && result.data!["location"]).toEqual({ lat: -0.7167, lng: 36.4333 });
  });

  it("takes a coordinate that is already one", () => {
    const result = validateEntry(type, { name: "x", location: { lat: 1, lng: 2 } });
    expect(result.ok && result.data!["location"]).toEqual({ lat: 1, lng: 2 });
  });

  it("refuses a place that is not on Earth", () => {
    // A swapped pair puts a Nairobi business in the Indian Ocean, and nothing
    // downstream would notice.
    expect(validateEntry(type, { name: "x", location: "91, 36" }).ok).toBe(false);
    expect(validateEntry(type, { name: "x", location: "somewhere nice" }).ok).toBe(false);
    expect(validateEntry(type, { name: "x", location: "1" }).ok).toBe(false);
  });

  it("treats an empty input as no location rather than as an error", () => {
    const result = validateEntry(type, { name: "x", location: "" });
    expect(result.ok).toBe(true);
    expect(result.ok && result.data!["location"]).toBeUndefined();
  });
});

/**
 * Opening hours, from the box they are edited in.
 *
 * The admin edits them as JSON in a textarea, so what arrives is a string where
 * the schema wants a structure. Without coercion, saving a stylist reported
 * "Invalid input" naming no field — and saving one whose box was empty wiped
 * the hours the whole site's availability is computed from.
 */
describe("a week of opening hours", () => {
  const type = ContentType.parse({
    key: "staff",
    label: "Stylist",
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "workingHours", label: "Working hours", type: "hours" },
    ],
  });

  const hours = { tue: [{ from: "09:00", to: "17:00" }] };

  it("reads the JSON the form posts", () => {
    const result = validateEntry(type, { name: "Amina", workingHours: JSON.stringify(hours) });
    expect(result.ok).toBe(true);
    expect(result.ok && result.data!["workingHours"]).toEqual(hours);
  });

  it("takes the structure directly, for every other writer", () => {
    const result = validateEntry(type, { name: "Amina", workingHours: hours });
    expect(result.ok && result.data!["workingHours"]).toEqual(hours);
  });

  it("treats an empty box as no hours", () => {
    const result = validateEntry(type, { name: "Amina", workingHours: "   " });
    expect(result.ok).toBe(true);
    expect(result.ok && result.data!["workingHours"]).toBeUndefined();
  });

  it("refuses something that is not hours, naming the field", () => {
    const result = validateEntry(type, { name: "Amina", workingHours: "tuesday mornings" });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors ?? {})).toContain("workingHours");
  });
});
