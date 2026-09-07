/**
 * Diff tests.
 *
 * These are about *readability*, not correctness of the algorithm — the claim
 * doc 13 makes is that a non-developer can tell what a change does, so a test
 * that only checked "a change was detected" would miss the point entirely.
 *
 * Two properties are load-bearing and both have their own cases below: nothing
 * destructive may be silent, and nothing destructive may be reported without
 * saying what it costs.
 */
import { describe, expect, it } from "vitest";

import { diffSpecs, summarise } from "./diff.js";
import { SiteSpec } from "./site.js";

const base = SiteSpec.parse({
  specVersion: 1,
  name: "Riverside Salon",
  theme: {
    colors: { brand: "#1a7f5a" },
    fonts: { body: "Inter" },
    typeScale: { md: "1rem" },
  },
  content: [
    {
      key: "booking",
      label: "Booking",
      fields: [
        { name: "reference", label: "Reference", type: "text", required: true },
        { name: "customerName", label: "Customer name", type: "text", required: true },
      ],
    },
  ],
  pages: [
    {
      key: "home",
      path: "/",
      title: "Home",
      blocks: [
        { type: "section", children: [{ type: "heading", attrs: { text: "What we do" } }] },
        { type: "section", children: [{ type: "heading", attrs: { text: "The team" } }] },
      ],
    },
  ],
  logic: [
    {
      key: "notify",
      trigger: { on: "entry.transitioned", type: "booking", to: "confirmed" },
      steps: [{ action: "sms-send" }],
    },
  ],
});

/** Structured edit, so a test never depends on YAML text. */
const edit = (fn: (draft: Record<string, unknown>) => void) => {
  const draft = structuredClone(base) as unknown as Record<string, unknown>;
  fn(draft);
  return SiteSpec.parse(draft);
};

const counts = { booking: 340 };

describe("additive changes read as reassurance", () => {
  it("names the field, the type, and what happens to existing entries", () => {
    const after = edit((d) => {
      (d["content"] as { fields: unknown[] }[])[0]!.fields.push({
        name: "phone",
        label: "Phone",
        type: "phone",
      });
    });
    const [change] = diffSpecs(base, after, counts);
    expect(change!.classification).toBe("additive");
    expect(change!.summary).toBe("Adds a Phone field to Booking.");
    // The sentence doc 13 uses as its worked example.
    expect(change!.impact).toBe("It is optional, so 340 existing bookings will have it empty.");
  });

  it("warns when a new field is required, because that is different", () => {
    const after = edit((d) => {
      (d["content"] as { fields: unknown[] }[])[0]!.fields.push({
        name: "phone",
        label: "Phone",
        type: "phone",
        required: true,
      });
    });
    expect(diffSpecs(base, after, counts)[0]!.impact).toMatch(/will need this filled in/);
  });
});

describe("destructive changes say what they cost", () => {
  it("quantifies a removed field", () => {
    const after = edit((d) => {
      const type = (d["content"] as { fields: { name: string }[] }[])[0]!;
      type.fields = type.fields.filter((f) => f.name !== "reference");
    });
    const [change] = diffSpecs(base, after, counts);
    expect(change!.classification).toBe("destructive");
    expect(change!.impact).toMatch(/340 existing bookings will be deleted/);
  });

  it("says nothing is lost when there is nothing to lose", () => {
    const after = edit((d) => {
      const type = (d["content"] as { fields: { name: string }[] }[])[0]!;
      type.fields = type.fields.filter((f) => f.name !== "reference");
    });
    expect(diffSpecs(base, after, {})[0]!.impact).toMatch(/No entries exist yet/);
  });

  it("flags a moved page as a broken address, not a rename", () => {
    // The change an owner is least likely to anticipate, and doc 08 makes
    // automatic redirects structural precisely because of it.
    const after = edit((d) => {
      (d["pages"] as { path: string }[])[0]!.path = "/home";
    });
    const [change] = diffSpecs(base, after, counts);
    expect(change!.classification).toBe("destructive");
    expect(change!.impact).toMatch(/old address stops working/);
  });

  it("never reports a destructive change without an impact", () => {
    // The rule that makes the review defensible: "removes a field" alone is not
    // enough information to say yes to.
    const after = edit((d) => {
      d["content"] = [];
      d["pages"] = [];
      d["logic"] = [];
    });
    const changes = diffSpecs(base, after, counts);
    expect(changes.length).toBeGreaterThan(0);
    for (const change of changes.filter((c) => c.classification === "destructive")) {
      expect(change.impact, change.summary).toBeTruthy();
    }
  });

  it("sorts destructive changes first", () => {
    const after = edit((d) => {
      const type = (d["content"] as { fields: { name: string }[] }[])[0]!;
      type.fields = type.fields.filter((f) => f.name !== "reference");
      type.fields.push({ name: "notes", label: "Notes", type: "text" } as never);
    });
    const changes = diffSpecs(base, after, counts);
    // Burying a deletion under six renames is how a reviewer says yes to
    // something they did not read.
    expect(changes[0]!.classification).toBe("destructive");
  });
});

describe("page structure", () => {
  it("sees a reorder of two structurally identical sections", () => {
    // The first version compared block *types* only. The salon's "The team" and
    // "What we do" sections have identical shape, so swapping them produced an
    // identical outline and the diff reported nothing at all — on one of the
    // most common things an owner asks for.
    const after = edit((d) => {
      const blocks = d["pages"] as { blocks: unknown[] }[];
      blocks[0]!.blocks.reverse();
    });
    const changes = diffSpecs(base, after, counts);
    expect(changes.length).toBe(1);
    expect(changes[0]!.summary).toMatch(/Reorders the sections/);
  });

  it("distinguishes adding a section from reordering one", () => {
    const after = edit((d) => {
      const blocks = d["pages"] as { blocks: unknown[] }[];
      blocks[0]!.blocks.push({
        type: "section",
        children: [{ type: "heading", attrs: { text: "Testimonials" } }],
      });
    });
    expect(diffSpecs(base, after, counts)[0]!.summary).toMatch(/adds .*Testimonials/);
  });
});

describe("automations are described as rules, not as data", () => {
  it("phrases a trigger the way the owner asked for it", () => {
    const after = edit((d) => {
      (d["logic"] as unknown[]).push({
        key: "remind",
        trigger: { on: "entry.created", type: "booking" },
        steps: [{ action: "email-send" }],
      });
    });
    expect(diffSpecs(base, after, counts)[0]!.summary).toMatch(
      /when a new booking is created, 1 action runs/,
    );
  });

  it("treats turning an automation off as destructive", () => {
    const after = edit((d) => {
      (d["logic"] as { enabled: boolean }[])[0]!.enabled = false;
    });
    const [change] = diffSpecs(base, after, counts);
    expect(change!.classification).toBe("destructive");
    expect(change!.impact).toMatch(/stops happening/);
  });
});

describe("no change", () => {
  it("reports nothing when nothing changed", () => {
    expect(diffSpecs(base, base, counts)).toEqual([]);
    expect(summarise([])).toEqual({ total: 0, destructive: 0, classification: "additive" });
  });

  it("ignores key order, because a stored spec comes back reordered", () => {
    // Postgres `jsonb` does not preserve insertion order, so a spec compared
    // against the copy of itself that was just saved had different key order
    // and nothing else. Comparing serialised JSON made that a change: `fcms
    // plan` reported edited colours and an edited layout immediately after a
    // successful `fcms apply`.
    const reordered = JSON.parse(JSON.stringify(base), (_, value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? // `entries()` is already a fresh array, and `toReversed` needs a lib
          // newer than this package targets.
          // oxlint-disable-next-line no-array-reverse
          Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse())
        : value,
    ) as typeof base;

    expect(diffSpecs(base, reordered, counts)).toEqual([]);
  });
});
