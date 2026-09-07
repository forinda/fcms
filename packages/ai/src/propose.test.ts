/**
 * What `propose` does with each kind of reply.
 *
 * The provider is a stub, so these cost nothing and test the part that decides
 * what the owner sees: a spec, an honest refusal, or a failure that says what
 * was wrong. ADR 0018 §4 makes the middle one an answer rather than an error,
 * and that distinction is only real if it is enforced here.
 */
import { describe, expect, it } from "vitest";
import { printSpec } from "@forinda-cms/lang";
import { SiteSpec } from "@forinda-cms/spec";

import { propose, type Provider } from "./index.js";

const spec = SiteSpec.parse({
  specVersion: 2,
  name: "Riverside Salon",
  theme: { colors: { brand: "#1a7f5a" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
  content: [],
  pages: [{ key: "home", path: "/", title: "Home", blocks: [] }],
});

function saying(response: string): Provider & { seen: { system: string; user: string }[] } {
  const seen: { system: string; user: string }[] = [];
  return {
    name: "stub",
    seen,
    async complete(system, user) {
      seen.push({ system, user });
      return response;
    },
  };
}

const renamed = printSpec({ ...spec, name: "Riverside Salon & Spa" });

describe("proposing a change", () => {
  it("returns the spec the model wrote", async () => {
    const result = await propose({
      provider: saying(`Here you go:\n\n\`\`\`yaml\n${renamed}\n\`\`\``),
      spec,
      instruction: "rename the site",
    });

    expect(result.kind).toBe("spec");
    expect(result.kind === "spec" && result.spec.name).toBe("Riverside Salon & Spa");
  });

  it("sends the current spec, so the model edits what exists", async () => {
    const provider = saying(`\`\`\`yaml\n${renamed}\n\`\`\``);
    await propose({ provider, spec, instruction: "rename the site" });

    expect(provider.seen[0]!.user).toContain("Riverside Salon");
    expect(provider.seen[0]!.user).toContain("rename the site");
    // The schema travels with it: the model is told what it may write, rather
    // than being expected to remember.
    expect(provider.seen[0]!.user).toContain("JSON Schema");
  });

  it("treats a refusal as an answer, and drops the sentinel", async () => {
    const result = await propose({
      provider: saying("CANNOT_EXPRESS\n\nThat needs custom code, which a spec cannot express."),
      spec,
      instruction: "add a currency converter",
    });

    expect(result.kind).toBe("declined");
    expect(result.kind === "declined" && result.reason).toBe(
      "That needs custom code, which a spec cannot express.",
    );
    // The owner should never see the machine token.
    expect(result.kind === "declined" && result.reason).not.toContain("CANNOT_EXPRESS");
  });

  it("takes the spec when the model both explains itself and produces one", async () => {
    // Rejecting this would punish thoroughness: the work is done, and the
    // caveat is worth reading.
    const result = await propose({
      provider: saying(
        `This is close but the price rule cannot be exact.\n\n\`\`\`yaml\n${renamed}\n\`\`\``,
      ),
      spec,
      instruction: "rename the site",
    });

    expect(result.kind).toBe("spec");
  });

  it("reports a reply with no specification in it", async () => {
    const result = await propose({
      provider: saying("Sure! I have updated your site."),
      spec,
      instruction: "rename the site",
    });

    expect(result.kind).toBe("invalid");
    expect(result.kind === "invalid" && result.detail).toMatch(/no specification/i);
  });

  it("reports a specification that does not parse, with the line", async () => {
    const result = await propose({
      provider: saying("```yaml\nname: [unclosed\n```"),
      spec,
      instruction: "rename the site",
    });

    expect(result.kind).toBe("invalid");
    expect(result.kind === "invalid" && result.detail).toMatch(/line \d+/);
  });

  it("reports a specification that parses but is not valid", async () => {
    const result = await propose({
      provider: saying("```yaml\nname: Just a name\n```"),
      spec,
      instruction: "rename the site",
    });

    // Parses as YAML, is not a site. The owner is told, and nothing is written.
    expect(result.kind).toBe("invalid");
  });
});
