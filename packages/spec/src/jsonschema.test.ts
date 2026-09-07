import { describe, expect, it } from "vitest";
import { siteSpecJsonSchema } from "./jsonschema.js";

describe("JSON Schema generation (ADR 0006)", () => {
  it("emits a schema covering all five sections", () => {
    const schema = siteSpecJsonSchema();
    const props = Object.keys((schema as { properties?: object }).properties ?? {});
    expect(props).toEqual(
      expect.arrayContaining(["content", "pages", "logic", "access", "wiring"]),
    );
  });

  it("uses the input type, so defaulted fields are not required", () => {
    const schema = siteSpecJsonSchema() as { required?: string[] };
    // `logic`, `access` and `wiring` all carry .default() — an author omitting
    // them is writing a valid spec, and the output schema would reject it.
    expect(schema.required ?? []).not.toContain("logic");
    expect(schema.required ?? []).toContain("specVersion");
  });
});
