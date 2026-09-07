/**
 * Bringing a stored spec forward (ADR 0003 §3, first exercised by ADR 0024).
 *
 * The migration runs unattended on every boot of every install, so the
 * properties tested here are the ones that make that safe: it is deterministic,
 * it is idempotent, and it never silently drops what it does not understand.
 */
import { describe, expect, it } from "vitest";

import { migrateSpec } from "./migrate.js";
import { SPEC_VERSION } from "./site.js";

const stored = {
  specVersion: 1,
  name: "Riverside Salon",
  logic: [
    {
      key: "confirm",
      trigger: { on: "entry.created", type: "booking" },
      steps: [{ action: "sms-send" }],
    },
  ],
  pages: [
    {
      key: "book",
      flows: [
        { key: "booking", onComplete: [{ action: "booking-create" }, { action: "email-send" }] },
      ],
    },
  ],
};

describe("spec migration", () => {
  it("turns kebab action names into the namespaced form", () => {
    const migrated = migrateSpec(stored, SPEC_VERSION) as typeof stored;

    expect(migrated.specVersion).toBe(SPEC_VERSION);
    expect(migrated.logic[0]!.steps[0]!.action).toBe("sms.send");
    // A flow's `onComplete` hands to the same registry, so it carries the same
    // names and needs the same fix.
    expect(migrated.pages[0]!.flows![0]!.onComplete.map((s) => s.action)).toEqual([
      "booking.create",
      "email.send",
    ]);
  });

  it("is idempotent — a second run changes nothing", () => {
    const once = migrateSpec(stored, SPEC_VERSION);
    expect(migrateSpec(once, SPEC_VERSION)).toEqual(once);
  });

  it("leaves a name it cannot convert rather than dropping the step", () => {
    // The failure then is a validation error naming the step, not an automation
    // that quietly disappeared on upgrade.
    const odd = { ...stored, logic: [{ ...stored.logic[0]!, steps: [{ action: "publish" }] }] };
    const migrated = migrateSpec(odd, SPEC_VERSION) as typeof stored;

    expect(migrated.logic[0]!.steps[0]!.action).toBe("publish");
    expect(migrated.logic[0]!.steps).toHaveLength(1);
  });

  it("keeps everything it was not asked about", () => {
    const migrated = migrateSpec(stored, SPEC_VERSION) as typeof stored;
    expect(migrated.name).toBe("Riverside Salon");
    expect(migrated.logic[0]!.trigger).toEqual({ on: "entry.created", type: "booking" });
  });

  it("refuses to guess about a document from a newer release", () => {
    const future = { specVersion: 99, name: "From the future" };
    expect(migrateSpec(future, SPEC_VERSION)).toEqual(future);
  });

  it("hands back anything that is not a document", () => {
    expect(migrateSpec(null, SPEC_VERSION)).toBeNull();
    expect(migrateSpec([1, 2], SPEC_VERSION)).toEqual([1, 2]);
  });
});
