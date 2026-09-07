/**
 * Nightly availability (ADR 0025).
 *
 * The two rules that carry the record get the most cases: nights are half-open,
 * so a changeover day is bookable; and anything unreadable is busy, because a
 * false "available" is two families at one door.
 */
import { describe, expect, it } from "vitest";
import { SiteSpec, type ContentType } from "@forinda-cms/spec";

import { staticSource, withDerived } from "./entries.js";
import { generateStay, calendarDate } from "./stay.js";

const derived = {
  kind: "stay" as const,
  resource: { type: "room" },
  occupied: { type: "booking", resource: "room", from: "checkIn", to: "checkOut" },
  range: { from: "check-in", to: "check-out" },
  window: { days: 365 },
};

const rooms = [
  { id: "1", slug: "garden", name: "Garden room", price: 8000 },
  { id: "2", slug: "attic", name: "Attic room", price: 6000 },
];

const source = (bookings: Record<string, unknown>[] = []) =>
  staticSource({ room: rooms, booking: bookings });

const now = new Date("2026-09-07T10:00:00Z");
const search = (params: Record<string, string>, bookings: Record<string, unknown>[] = []) =>
  generateStay(source(bookings), derived, { now, params });

describe("dates", () => {
  it("reads a calendar date and refuses anything else", () => {
    expect(calendarDate("2026-10-03")).toBe(Date.UTC(2026, 9, 3));
    expect(calendarDate("2026-10-03T14:00:00Z")).toBe(Date.UTC(2026, 9, 3));
    expect(calendarDate("not a date")).toBeNull();
    expect(calendarDate(undefined)).toBeNull();
    // `Date.UTC` rolls this into March rather than rejecting it, and a date that
    // means a different day than it says is a date to refuse.
    expect(calendarDate("2026-02-31")).toBeNull();
  });
});

describe("what a search returns", () => {
  it("offers every free room for the nights asked for", () => {
    const rows = search({ "check-in": "2026-10-03", "check-out": "2026-10-07" });

    expect(rows.map((r) => r["slug"])).toEqual(["garden", "attic"]);
    expect(rows[0]).toMatchObject({ nights: 4, checkIn: "2026-10-03", checkOut: "2026-10-07" });
    // The resource's own fields come with it, so a card shows the room.
    expect(rows[0]!["name"]).toBe("Garden room");
  });

  it("claims nothing when nobody has searched yet", () => {
    // A listing page works before a date is picked, and nothing on it has said
    // anything is available.
    const rows = search({});
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ nights: null, checkIn: null, checkOut: null });
  });

  it("offers nothing for a range that cannot be honoured", () => {
    // Returning everything here would be a page reporting "2 rooms available"
    // for a stay nobody can book.
    expect(search({ "check-in": "2026-10-07", "check-out": "2026-10-03" })).toEqual([]);
    expect(search({ "check-in": "2026-10-03", "check-out": "2026-10-03" })).toEqual([]);
    expect(search({ "check-in": "2026-10-03" })).toEqual([]);
    expect(search({ "check-in": "2026-10-03", "check-out": "nonsense" })).toEqual([]);
    // Yesterday, and beyond the declared window.
    expect(search({ "check-in": "2026-09-01", "check-out": "2026-09-03" })).toEqual([]);
    expect(search({ "check-in": "2028-01-01", "check-out": "2028-01-03" })).toEqual([]);
  });
});

describe("occupancy", () => {
  const booked = [{ id: "b1", room: "garden", checkIn: "2026-10-03", checkOut: "2026-10-07" }];

  it("takes a room out for nights that overlap", () => {
    const overlapping = [
      ["2026-10-03", "2026-10-07"], // exactly it
      ["2026-10-02", "2026-10-04"], // starts before
      ["2026-10-06", "2026-10-09"], // ends after
      ["2026-10-04", "2026-10-05"], // inside it
      ["2026-10-01", "2026-10-31"], // around it
    ];
    for (const [from, to] of overlapping) {
      const rows = search({ "check-in": from!, "check-out": to! }, booked);
      expect(rows.map((r) => r["slug"])).toEqual(["attic"]);
    }
  });

  it("leaves the changeover day bookable", () => {
    // A booking that ends on the 7th does not occupy the night of the 7th. An
    // inclusive comparison hides a free night on every changeover day, which on
    // a small property is a real share of the inventory.
    expect(
      search({ "check-in": "2026-10-07", "check-out": "2026-10-09" }, booked).map((r) => r["slug"]),
    ).toEqual(["garden", "attic"]);
    expect(
      search({ "check-in": "2026-10-01", "check-out": "2026-10-03" }, booked).map((r) => r["slug"]),
    ).toEqual(["garden", "attic"]);
  });

  it("treats a booking it cannot read as occupying everything", () => {
    // Not knowing when a room is free is not a reason to offer it.
    const broken = [{ id: "b1", room: "garden", checkIn: "soon", checkOut: "later" }];
    expect(
      search({ "check-in": "2026-10-03", "check-out": "2026-10-07" }, broken).map((r) => r["slug"]),
    ).toEqual(["attic"]);

    const backwards = [{ id: "b2", room: "attic", checkIn: "2026-10-07", checkOut: "2026-10-03" }];
    expect(
      search({ "check-in": "2026-11-03", "check-out": "2026-11-07" }, backwards).map(
        (r) => r["slug"],
      ),
    ).toEqual(["garden"]);
  });

  it("matches a booking that names its room as a reference", () => {
    const byRef = [
      { id: "b1", room: "ref:room/garden", checkIn: "2026-10-03", checkOut: "2026-10-07" },
    ];
    expect(
      search({ "check-in": "2026-10-04", "check-out": "2026-10-06" }, byRef).map((r) => r["slug"]),
    ).toEqual(["attic"]);
  });
});

describe("as a content type", () => {
  const spec = SiteSpec.parse({
    specVersion: 2,
    name: "Riverside Rooms",
    theme: { colors: { brand: "#1a7f5a" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
    content: [
      {
        key: "room",
        label: "Room",
        fields: [
          { name: "name", label: "Name", type: "text" },
          { name: "price", label: "Price", type: "number" },
        ],
      },
      {
        key: "booking",
        label: "Booking",
        fields: [
          { name: "room", label: "Room", type: "reference", to: "room" },
          { name: "checkIn", label: "Check in", type: "date" },
          { name: "checkOut", label: "Check out", type: "date" },
        ],
      },
      {
        key: "vacancy",
        label: "Vacancy",
        derived,
        fields: [
          { name: "name", label: "Name", type: "text" },
          { name: "price", label: "Price", type: "number" },
          { name: "nights", label: "Nights", type: "number" },
          {
            name: "total",
            label: "Total",
            type: "computed",
            formula: { op: "multiply", of: [{ field: "price" }, { field: "nights" }] },
          },
        ],
      },
    ],
    pages: [],
  });

  it("computes a total across the nights, with nothing new", () => {
    // The property ADR 0014 bought and this inherits: a derived row is an entry,
    // so computed fields work on it unchanged.
    const rows = withDerived(spec, source(), now, {
      "check-in": "2026-10-03",
      "check-out": "2026-10-07",
    }).all("vacancy");

    expect(rows[0]).toMatchObject({ slug: "garden", nights: 4, total: 32000 });
  });

  it("validates as a content type", () => {
    expect((spec.content[2] as ContentType).derived?.kind).toBe("stay");
  });
});
