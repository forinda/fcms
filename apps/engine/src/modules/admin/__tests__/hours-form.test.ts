/**
 * The week, gathered out of the boxes it was filled in (ADR 0039).
 *
 * The failure this guards against is silent: a slot half filled in is a day
 * that never closes, and the availability computed from it produces nothing
 * rather than an error.
 */
import { describe, expect, it } from "vitest";
import { ContentType } from "@forinda-cms/spec";

import { gatherHours } from "../utils/http";

const type = ContentType.parse({
  key: "staff",
  label: "Stylist",
  fields: [
    { name: "name", label: "Name", type: "text", required: true },
    { name: "workingHours", label: "Working hours", type: "hours" },
  ],
});

const posted = (over: Record<string, string> = {}) => ({
  name: "Amina",
  workingHours__mon__0__from: "",
  workingHours__mon__0__to: "",
  workingHours__tue__0__from: "09:00",
  workingHours__tue__0__to: "17:00",
  workingHours__tue__1__from: "",
  workingHours__tue__1__to: "",
  ...over,
});

describe("gathering a week", () => {
  it("keeps the days that were filled in and drops the ones that were not", () => {
    expect(gatherHours(type, posted())["workingHours"]).toEqual({
      tue: [{ from: "09:00", to: "17:00" }],
    });
  });

  it("keeps a split shift in order", () => {
    const week = gatherHours(
      type,
      posted({ workingHours__tue__1__from: "15:00", workingHours__tue__1__to: "19:00" }),
    )["workingHours"];

    expect(week).toEqual({
      tue: [
        { from: "09:00", to: "17:00" },
        { from: "15:00", to: "19:00" },
      ],
    });
  });

  it("keeps a half-filled slot, so the schema can refuse it", () => {
    // Dropping it would save half of what somebody typed and report success.
    expect(gatherHours(type, posted({ workingHours__tue__0__to: "" }))["workingHours"]).toEqual({
      tue: [{ from: "09:00", to: "" }],
    });
  });

  it("clears the field when every box is empty", () => {
    const week = gatherHours(
      type,
      posted({ workingHours__tue__0__from: "", workingHours__tue__0__to: "" }),
    );
    expect(week["workingHours"]).toBeUndefined();
  });

  it("takes the flat names out of the data", () => {
    // They are this form's business. Left in, they reach a `.strict()` schema
    // as unknown keys and the save fails naming a field nobody has heard of.
    const gathered = gatherHours(type, posted());
    expect(Object.keys(gathered).filter((k) => k.includes("__"))).toEqual([]);
  });

  it("leaves an API caller's structure alone", () => {
    // No `workingHours__…` keys means the grid was never rendered — a CLI or
    // an MCP write, which sends the structure directly.
    const direct = { name: "Amina", workingHours: { tue: [{ from: "09:00", to: "17:00" }] } };
    expect(gatherHours(type, direct)).toEqual(direct);
  });

  it("does nothing at all to a type with no hours", () => {
    const simple = ContentType.parse({
      key: "service",
      label: "Service",
      fields: [{ name: "name", label: "Name", type: "text" }],
    });
    expect(gatherHours(simple, { name: "Cut" })).toEqual({ name: "Cut" });
  });
});
