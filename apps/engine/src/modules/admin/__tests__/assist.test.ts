/**
 * The assistant, with the model stubbed.
 *
 * What matters here is not the model — it is what the owner is shown for each
 * kind of answer, and that nothing is written on the way. ADR 0018 §1 says the
 * assistant proposes and a person applies; that is only true if `suggest`
 * cannot reach the apply path, which these hold.
 */
import { describe, expect, it } from "vitest";
import type { Provider } from "@forinda-cms/ai";
import { printSpec } from "@forinda-cms/lang";
import { SiteSpec } from "@forinda-cms/spec";

import { ApplySpecUseCase } from "../use-cases/apply-spec.usecase";
import { AssistUseCase } from "../use-cases/assist.usecase";

const spec = SiteSpec.parse({
  specVersion: 1,
  name: "Riverside Salon",
  theme: { colors: { brand: "#1a7f5a" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
  content: [
    { key: "service", label: "Service", fields: [{ name: "name", label: "Name", type: "text" }] },
  ],
  pages: [{ key: "home", path: "/", title: "Home", blocks: [] }],
});

const renamed = printSpec({ ...spec, name: "Riverside Spa" });

function saying(response: string): Provider {
  return {
    name: "stub",
    async complete() {
      return response;
    },
  };
}

/** An assistant whose planning step reports the given diff, and never applies. */
function assistant(
  plan: Partial<{ changes: unknown[]; destructive: unknown[]; initial: boolean }> = {},
) {
  const applied: unknown[] = [];
  const apply = Object.assign(Object.create(ApplySpecUseCase.prototype) as ApplySpecUseCase, {
    plan: async () => ({
      changes: plan.changes ?? [
        { path: "/name", classification: "additive", summary: "Renames the site." },
      ],
      destructive: plan.destructive ?? [],
      migration: [],
      initial: plan.initial ?? false,
    }),
    execute: async (...args: unknown[]) => {
      applied.push(args);
      return { seq: 1, changes: [], migration: [] };
    },
  });
  return { assist: new AssistUseCase(apply), applied };
}

describe("suggesting a change", () => {
  it("returns the diff, not the specification", async () => {
    const { assist, applied } = assistant();
    const result = await assist.suggest(
      spec,
      "rename it",
      saying(`\`\`\`yaml\n${renamed}\n\`\`\``),
    );

    expect(result.kind).toBe("spec");
    expect(result.kind === "spec" && result.changes[0]!.summary).toBe("Renames the site.");
    // Proposing is not applying. If this ever fails, the product has changed
    // its safety story without anyone deciding to.
    expect(applied).toEqual([]);
  });

  it("counts the destructive changes, from the same classifier that will refuse them", async () => {
    const { assist } = assistant({
      destructive: [
        { path: "/content/service", classification: "destructive", summary: "Removes Service." },
      ],
    });
    const result = await assist.suggest(
      spec,
      "drop services",
      saying(`\`\`\`yaml\n${renamed}\n\`\`\``),
    );

    expect(result.kind === "spec" && result.destructive).toBe(1);
  });

  it("passes a refusal through as an answer", async () => {
    const { assist } = assistant();
    const result = await assist.suggest(
      spec,
      "add a currency converter",
      saying("CANNOT_EXPRESS\n\nThat needs arithmetic, which the spec cannot express."),
    );

    expect(result.kind).toBe("declined");
    expect(result.kind === "declined" && result.reason).toMatch(/arithmetic/);
  });

  it("turns a model failure into a sentence rather than a 500", async () => {
    const { assist } = assistant();
    const result = await assist.suggest(spec, "rename it", {
      name: "broken",
      async complete() {
        throw new Error("401 invalid x-api-key");
      },
    });

    expect(result.kind).toBe("unavailable");
    expect(result.kind === "unavailable" && result.reason).toMatch(/invalid x-api-key/);
  });

  it("is unavailable, not broken, when the install has no key", async () => {
    // ADR 0011 §3: exhausting AI must never stop someone editing their site, so
    // this path has to be a report rather than an exception.
    const original = process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];

    try {
      const { assist } = assistant();
      expect(assist.available).toBe(false);

      const result = await assist.suggest(spec, "rename it");
      expect(result.kind).toBe("unavailable");
      expect(result.kind === "unavailable" && result.reason).toMatch(/ANTHROPIC_API_KEY/);
    } finally {
      if (original !== undefined) process.env["ANTHROPIC_API_KEY"] = original;
    }
  });
});
