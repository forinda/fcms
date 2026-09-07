/**
 * Planner tests — the pure half: a spec pair in, a plan out, no database.
 *
 * The half that executes those plans lives with the use-case that runs them
 * (`src/shared/__tests__/migration.test.ts`), because applying a spec is an
 * application decision and this package is the model.
 */
import { describe, expect, it } from "vitest";
import { SiteSpec } from "@forinda-cms/spec";

import { indexName, planMigration } from "./planner.js";

const SITE = "site_planner";

const specWith = (fields: unknown[]) =>
  SiteSpec.parse({
    specVersion: 1,
    name: "Test",
    theme: { colors: { brand: "#000000" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
    content: [{ key: "service", label: "Service", fields }],
    pages: [],
  });

const plain = specWith([
  { name: "name", label: "Name", type: "text" },
  { name: "price", label: "Price", type: "number" },
]);

const indexed = specWith([
  { name: "name", label: "Name", type: "text" },
  { name: "price", label: "Price", type: "number", filterable: true },
]);

const dropped = specWith([{ name: "name", label: "Name", type: "text" }]);

describe("planning (no database needed)", () => {
  it("indexes a field when it becomes filterable", () => {
    const steps = planMigration(plain, indexed, { siteId: SITE });
    expect(steps.length).toBe(1);
    expect(steps[0]!.kind).toBe("create-index");
    expect(steps[0]!.classification).toBe("additive");
    // Cast, or `10` sorts before `9`.
    expect(steps[0]!.statement).toContain("::numeric");
    // Scoped by the WHERE clause rather than by a table-wide column — the
    // deviation from doc 03 §2 that makes a shared entries table workable.
    expect(steps[0]!.statement).toContain(`site_id = '${SITE}'`);
    expect(steps[0]!.statement).toContain("type_key = 'service'");
  });

  it("plans nothing when nothing relevant changed", () => {
    expect(planMigration(indexed, indexed, { siteId: SITE })).toEqual([]);
  });

  it("rebuilds an index when the field's type changes", () => {
    const asText = specWith([
      { name: "name", label: "Name", type: "text" },
      { name: "price", label: "Price", type: "text", filterable: true },
    ]);
    const steps = planMigration(indexed, asText, { siteId: SITE });
    // Drop before create: the old expression would answer with the wrong
    // ordering rather than not answer at all.
    expect(steps.map((s) => s.kind)).toEqual(["drop-index", "create-index"]);
  });

  it("treats removing a field's values as destructive and dropping its index as not", () => {
    const steps = planMigration(indexed, dropped, { siteId: SITE });
    const purge = steps.find((s) => s.kind === "purge-field")!;
    expect(purge.classification).toBe("destructive");
    expect(steps.find((s) => s.kind === "drop-index")!.classification).toBe("additive");
    expect(purge.description).toMatch(/Deletes the stored Price values/);
  });

  it("orders additive steps first, so an interrupted run leaves more rather than less", () => {
    const steps = planMigration(indexed, dropped, { siteId: SITE });
    expect(steps[0]!.classification).toBe("additive");
    expect(steps.at(-1)!.classification).toBe("destructive");
  });

  it("deletes a removed type's entries, and says so plainly", () => {
    const gone = SiteSpec.parse({ ...indexed, content: [] });
    const steps = planMigration(indexed, gone, { siteId: SITE });
    const del = steps.find((s) => s.kind === "delete-entries")!;
    expect(del.classification).toBe("destructive");
    expect(del.description).toMatch(/Deletes every stored Service record/);
  });

  it("gives an index a deterministic name inside Postgres's identifier limit", () => {
    const name = indexName(SITE, "service", "price");
    expect(name).toBe(indexName(SITE, "service", "price"));
    expect(name.length).toBeLessThanOrEqual(63);
    expect(indexName(SITE, "service", "name")).not.toBe(name);
  });

  it("refuses an identifier that could reach SQL unquoted", () => {
    // Spec keys are validated upstream, but a schema is a long way from a SQL
    // string and the assertion costs nothing.
    expect(() =>
      planMigration(undefined, indexed, { siteId: "bad'; drop table entries; --" }),
    ).toThrow(/unsafe site id/);
  });
});
