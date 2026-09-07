/**
 * The checks that fail if the ceiling slips.
 *
 * Most of these are not testing Zod — they are testing ADR 0001 and ADR 0009.
 * If one of them starts failing because someone "made the language more
 * flexible", that is the signal doc 12 warned about: the ceiling being lost by
 * increments rather than by decision.
 */
import { describe, expect, it } from "vitest";

import { Condition } from "./condition.js";
import { Integration } from "./wiring.js";
import { Page, dataNestingDepth } from "./pages.js";
import { StyleProps } from "./style.js";
import { TemplateString, parseTemplate } from "./primitives.js";
import { classify } from "./patch.js";
import { validateSpec } from "./index.js";

const theme = {
  colors: { brand: "#1a7f5a", surface: "#f5f5f4" },
  fonts: { body: "Inter" },
  typeScale: { sm: "0.875rem", md: "1rem", lg: "1.5rem" },
};

/** A minimal but real spec: a service list bound to a declared type. */
const base = {
  specVersion: 1 as const,
  name: "Test Salon",
  theme,
  content: [
    {
      key: "service",
      label: "Service",
      titleField: "name",
      fields: [
        { name: "name", label: "Name", type: "text" as const },
        { name: "active", label: "Active", type: "boolean" as const, filterable: true },
      ],
    },
  ],
  pages: [
    {
      key: "home",
      path: "/",
      title: "Home",
      blocks: [
        {
          type: "list",
          data: {
            from: "service",
            where: [{ field: "active", op: "eq" as const, value: true }],
            limit: 12,
          },
          item: [{ type: "card", attrs: { heading: "{{ item.name }}" } }],
        },
      ],
    },
  ],
};

describe("templates stay weak (ADR 0001)", () => {
  it("accepts property access and one formatter", () => {
    expect(parseTemplate("{{ item.name }} — {{ entry.price | currency }}")).toEqual([
      { path: "item.name", raw: "{{ item.name }}" },
      { path: "entry.price", formatter: "currency", raw: "{{ entry.price | currency }}" },
    ]);
  });

  it.each([
    ["{{ price * 2 }}", "arithmetic"],
    ["{{ fn(x) }}", "a call"],
    ["{{ a > b }}", "a comparison"],
    ["{{ items[0] }}", "dynamic lookup"],
  ])("rejects %s (%s)", (input) => {
    expect(TemplateString.safeParse(input).success).toBe(false);
  });

  it("rejects an unknown formatter rather than ignoring it", () => {
    expect(TemplateString.safeParse("{{ a.b | frobnicate }}").success).toBe(false);
  });
});

describe("conditions are structured, never expressions (ADR 0009)", () => {
  it("accepts the triple", () => {
    expect(Condition.safeParse({ field: "item.price", op: "gt", value: 100 }).success).toBe(true);
  });

  it("rejects an expression string in place of a triple", () => {
    expect(Condition.safeParse("item.price > 100").success).toBe(false);
  });

  it("rejects an unknown operator", () => {
    expect(Condition.safeParse({ field: "a", op: "matches", value: "x" }).success).toBe(false);
  });

  it("requires a list for `in` and a scalar for the rest", () => {
    expect(Condition.safeParse({ field: "a", op: "in", value: "x" }).success).toBe(false);
    expect(Condition.safeParse({ field: "a", op: "eq", value: ["x"] }).success).toBe(false);
    expect(Condition.safeParse({ field: "a", op: "in", value: ["x", "y"] }).success).toBe(true);
  });
});

describe("tier 2 stays token-valued (ADR 0004)", () => {
  it("accepts token references and enums", () => {
    const r = StyleProps.safeParse({
      padding: "lg",
      background: "token:color.surface",
      cols: { base: 1, md: 3 },
    });
    expect(r.success).toBe(true);
  });

  it.each([
    ["a raw colour", { background: "#ff0000" }],
    ["a px value", { padding: "24px" }],
    ["margin, which is excluded by name", { margin: "lg" }],
    ["absolute positioning", { position: "absolute" }],
  ])("rejects %s", (_label, props) => {
    expect(StyleProps.safeParse(props).success).toBe(false);
  });
});

describe("queries are bounded (ADR 0009 §1)", () => {
  it("requires a limit", () => {
    const spec = structuredClone(base) as any;
    delete spec.pages[0].blocks[0].data.limit;
    expect(validateSpec(spec).ok).toBe(false);
  });

  it("refuses data without item, and item without data", () => {
    const noItem = structuredClone(base) as any;
    delete noItem.pages[0].blocks[0].item;
    expect(validateSpec(noItem).ok).toBe(false);
  });

  it("caps data nesting at one level", () => {
    const nested = structuredClone(base) as any;
    nested.pages[0].blocks[0].item = [
      { type: "card", data: { from: "service", limit: 3 }, item: [{ type: "text" }] },
    ];
    const result = Page.safeParse(nested.pages[0]);
    expect(result.success).toBe(false);
    expect(dataNestingDepth(nested.pages[0].blocks)).toBeGreaterThan(1);
  });
});

describe("cross-section references (the errors that reach customers)", () => {
  it("accepts a coherent spec", () => {
    expect(validateSpec(base).ok).toBe(true);
  });

  it("catches a query against an undeclared content type", () => {
    const spec = structuredClone(base) as any;
    spec.pages[0].blocks[0].data.from = "treatment";
    const r = validateSpec(spec);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.issues[0]!.message).toContain("treatment");
  });

  it("catches sorting by a field the type does not have", () => {
    const spec = structuredClone(base) as any;
    spec.pages[0].blocks[0].data.sort = { field: "price", dir: "asc" };
    expect(validateSpec(spec).ok).toBe(false);
  });

  it("catches two pages answering the same path", () => {
    const spec = structuredClone(base) as any;
    spec.pages.push({ ...spec.pages[0], key: "other" });
    expect(validateSpec(spec).ok).toBe(false);
  });

  it("catches a workflow waiting on a state nobody declared", () => {
    const spec = structuredClone(base) as any;
    spec.content[0].fields.push({
      name: "status",
      label: "Status",
      type: "state",
      initial: "draft",
      values: ["draft", "live"],
      transitions: [{ from: "draft", to: ["live"] }],
    });
    spec.logic = [
      {
        key: "notify",
        trigger: { on: "entry.transitioned", type: "service", to: "archived" },
        steps: [{ action: "email-send" }],
      },
    ];
    expect(validateSpec(spec).ok).toBe(false);
  });
});

describe("state fields declare a closed machine (ADR 0009 §4)", () => {
  it("rejects an initial state outside values", () => {
    const spec = structuredClone(base) as any;
    spec.content[0].fields.push({
      name: "status",
      label: "Status",
      type: "state",
      initial: "nowhere",
      values: ["draft", "live"],
      transitions: [{ from: "draft", to: ["live"] }],
    });
    expect(validateSpec(spec).ok).toBe(false);
  });
});

describe("secrets never enter the spec (ADR 0001)", () => {
  it("accepts a secret reference", () => {
    const r = Integration.safeParse({
      key: "mpesa",
      kind: "payment.mpesa",
      config: { shortcode: "174379" },
      secrets: { consumerKey: "secret:MPESA_CONSUMER_KEY" },
    });
    expect(r.success).toBe(true);
  });

  it("flags a credential pasted into config", () => {
    const r = Integration.safeParse({
      key: "mpesa",
      kind: "payment.mpesa",
      config: { consumerKey: "A7fQ2xLm90ZbNq4RtYuVwXcE13sPdKgH" },
    });
    expect(r.success).toBe(false);
  });
});

describe("patches classify for the gate (doc 03)", () => {
  it("treats removal and movement as destructive", () => {
    expect(classify([{ op: "set", path: "/name", value: "x" }])).toBe("additive");
    expect(classify([{ op: "insert", path: "/pages/0", value: {} }])).toBe("additive");
    expect(classify([{ op: "remove", path: "/content/0/fields/1" }])).toBe("destructive");
    expect(
      classify([
        { op: "set", path: "/name", value: "x" },
        { op: "move", path: "/pages/0/blocks/0", to: "/pages/0/blocks/2" },
      ]),
    ).toBe("destructive");
  });

  it("refuses a request-driven filter on a field with no index", () => {
    // ADR 0019 §1: a visitor-driven filter must be `filterable`, which is the
    // flag the migration planner indexes on. Without it the page gets slower as
    // the business grows — the bug an owner cannot see.
    const result = validateSpec({
      specVersion: 1,
      name: "Salon",
      theme: { colors: { brand: "#000000" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
      content: [
        {
          key: "service",
          label: "Service",
          fields: [{ name: "name", label: "Name", type: "text" }],
        },
      ],
      pages: [
        {
          key: "find",
          path: "/find",
          title: "Find",
          blocks: [
            {
              type: "list",
              data: {
                from: "service",
                where: [{ field: "name", op: "contains", value: { param: "q" } }],
                limit: 10,
              },
              item: [{ type: "text", attrs: { text: "{{ item.name }}" } }],
            },
          ],
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.issues[0]!.message).toMatch(/not marked filterable/);
  });

  it("refuses a visitor-chosen sort naming a field the type does not have", () => {
    const result = validateSpec({
      specVersion: 1,
      name: "Salon",
      theme: { colors: { brand: "#000000" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
      content: [
        {
          key: "service",
          label: "Service",
          fields: [{ name: "name", label: "Name", type: "text" }],
        },
      ],
      pages: [
        {
          key: "find",
          path: "/find",
          title: "Find",
          blocks: [
            {
              type: "list",
              data: {
                from: "service",
                sort: { param: "sort", allow: ["name", "rating"] },
                limit: 10,
              },
              item: [{ type: "text", attrs: { text: "{{ item.name }}" } }],
            },
          ],
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.issues[0]!.message).toMatch(/"rating"/);
  });

  it("refuses an aggregate whose relation does not exist", () => {
    // Silently always null reads as "no reviews yet" forever, which is the kind
    // of wrong that never gets reported.
    const result = validateSpec({
      specVersion: 1,
      name: "Stays",
      theme: { colors: { brand: "#000000" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
      content: [
        {
          key: "property",
          label: "Property",
          fields: [
            { name: "name", label: "Name", type: "text" },
            {
              name: "rating",
              label: "Rating",
              type: "aggregate",
              of: "review",
              on: "hotel",
              field: "score",
              fn: "avg",
            },
          ],
        },
        {
          key: "review",
          label: "Review",
          fields: [{ name: "score", label: "Score", type: "number" }],
        },
      ],
      pages: [],
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.issues[0]!.message).toMatch(/no field "hotel"/);
  });

  it("refuses an average with nothing named to average", () => {
    const result = validateSpec({
      specVersion: 1,
      name: "Stays",
      theme: { colors: { brand: "#000000" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
      content: [
        {
          key: "property",
          label: "Property",
          fields: [
            { name: "name", label: "Name", type: "text" },
            {
              name: "rating",
              label: "Rating",
              type: "aggregate",
              of: "review",
              on: "property",
              fn: "avg",
            },
          ],
        },
        {
          key: "review",
          label: "Review",
          fields: [
            { name: "property", label: "Property", type: "reference", to: "property" },
            { name: "score", label: "Score", type: "number" },
          ],
        },
      ],
      pages: [],
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.issues[0]!.message).toMatch(/needs a field/);
  });

  it("refuses a formula naming a field the type does not have", () => {
    // Evaluating to null forever reads as "free" on a price, and nobody
    // reports a price of zero as a bug in a formula.
    const result = validateSpec({
      specVersion: 1,
      name: "Stays",
      theme: { colors: { brand: "#000000" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
      content: [
        {
          key: "room",
          label: "Room",
          fields: [
            { name: "price", label: "Price", type: "number" },
            {
              name: "total",
              label: "Total",
              type: "computed",
              formula: { op: "multiply", of: [{ field: "rate" }, { param: "nights" }] },
            },
          ],
        },
      ],
      pages: [],
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.issues[0]!.message).toMatch(/"rate"/);
  });

  it("refuses a formula that refers to itself", () => {
    const result = validateSpec({
      specVersion: 1,
      name: "Stays",
      theme: { colors: { brand: "#000000" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
      content: [
        {
          key: "room",
          label: "Room",
          fields: [
            { name: "price", label: "Price", type: "number" },
            {
              name: "total",
              label: "Total",
              type: "computed",
              formula: { op: "add", of: [{ field: "total" }, { value: 1 }] },
            },
          ],
        },
      ],
      pages: [],
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.issues[0]!.message).toMatch(/itself/);
  });

  it("refuses a subtraction with one operand, where order is the whole meaning", () => {
    const result = validateSpec({
      specVersion: 1,
      name: "Stays",
      theme: { colors: { brand: "#000000" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
      content: [
        {
          key: "room",
          label: "Room",
          fields: [
            { name: "price", label: "Price", type: "number" },
            {
              name: "total",
              label: "Total",
              type: "computed",
              formula: { op: "subtract", of: [{ field: "price" }] },
            },
          ],
        },
      ],
      pages: [],
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.issues[0]!.message).toMatch(/at least two/);
  });
});

/**
 * Components (ADR 0022) — one level, referenced by key, and never styled where
 * they are placed. Each of these is a rule that only holds if the whole
 * document is checked, which is why they live in `checkReferences`.
 */
describe("reusable components", () => {
  const cta = { key: "cta", label: "Call to action", blocks: [{ type: "heading" }] };
  const place = (blocks: unknown[]) => ({
    ...base,
    components: [cta],
    pages: [{ ...base.pages[0]!, blocks }],
  });

  it("accepts an instance that names a component that exists", () => {
    expect(validateSpec(place([{ type: "component", attrs: { use: "cta" } }])).ok).toBe(true);
  });

  it("catches an instance naming a component that does not exist", () => {
    const result = validateSpec(place([{ type: "component", attrs: { use: "gone" } }]));
    expect(result.ok === false && result.issues[0]!.message).toMatch(/unknown component "gone"/);
  });

  it("catches an instance that names nothing at all", () => {
    const result = validateSpec(place([{ type: "component" }]));
    expect(result.ok === false && result.issues[0]!.message).toMatch(/needs `use`/);
  });

  it("refuses a component inside a component — the rule that makes cycles impossible", () => {
    const result = validateSpec({
      ...base,
      components: [cta, { key: "band", blocks: [{ type: "component", attrs: { use: "cta" } }] }],
    });
    expect(result.ok === false && result.issues[0]!.message).toMatch(/one level deep/);
  });

  it("refuses styling on a place a component is used", () => {
    const result = validateSpec(
      place([{ type: "component", attrs: { use: "cta" }, style: { padding: "lg" } }]),
    );
    expect(result.ok === false && result.issues[0]!.message).toMatch(/on the component itself/);
  });

  it("refuses two components with the same key", () => {
    const result = validateSpec({ ...base, components: [cta, { ...cta, label: "Other" }] });
    expect(result.ok).toBe(false);
  });
});

/**
 * Payable types (ADR 0023 §2).
 *
 * The spec may say what a thing costs and through which integration; it may not
 * say anything about money moving. These are the checks that keep an owner from
 * shipping a form that takes a booking and charges nothing.
 */
describe("payments", () => {
  const payable = (
    payment: unknown,
    wiring: unknown[] = [{ key: "counter", kind: "payment.manual" }],
  ) => ({
    ...base,
    wiring,
    content: [
      {
        ...base.content[0]!,
        payment,
        fields: [
          ...base.content[0]!.fields,
          { name: "deposit", label: "Deposit", type: "number" as const },
        ],
      },
    ],
  });

  it("accepts a price read from a number field", () => {
    const result = validateSpec(
      payable({ amount: { field: "deposit" }, currency: "KES", via: "counter" }),
    );
    expect(result.ok).toBe(true);
  });

  it("catches a price that names a field the type does not have", () => {
    const result = validateSpec(
      payable({ amount: { field: "nope" }, currency: "KES", via: "counter" }),
    );
    expect(result.ok === false && result.issues[0]!.message).toMatch(/does not have/);
  });

  it("catches a price read from something that is not a number", () => {
    const result = validateSpec(
      payable({ amount: { field: "name" }, currency: "KES", via: "counter" }),
    );
    expect(result.ok === false && result.issues[0]!.message).toMatch(/has to be a number/);
  });

  it("catches an integration that cannot take money", () => {
    const result = validateSpec(
      payable({ amount: { fixed: 25000 }, currency: "KES", via: "post" }, [
        { key: "post", kind: "email" },
      ]),
    );
    expect(result.ok === false && result.issues[0]!.message).toMatch(/cannot take a payment/);
  });

  it("catches a payment routed through an integration that is switched off", () => {
    // Otherwise the form takes the booking and the charge silently never
    // happens — the failure an owner finds on their bank statement.
    const result = validateSpec(
      payable({ amount: { fixed: 25000 }, currency: "KES", via: "counter" }, [
        { key: "counter", kind: "payment.manual", enabled: false },
      ]),
    );
    expect(result.ok === false && result.issues[0]!.message).toMatch(/turned off/);
  });

  it("refuses a currency that is not one", () => {
    expect(
      validateSpec(payable({ amount: { fixed: 1 }, currency: "shillings", via: "counter" })).ok,
    ).toBe(false);
  });

  it("refuses a fixed price that is not a whole number of minor units", () => {
    expect(
      validateSpec(payable({ amount: { fixed: 12.5 }, currency: "KES", via: "counter" })).ok,
    ).toBe(false);
  });

  it("has no way to express a status", () => {
    // A spec that could say `paid` would be an editor with write access to the
    // ledger (ADR 0023 §2).
    expect(
      validateSpec(
        payable({ amount: { fixed: 1 }, currency: "KES", via: "counter", status: "paid" }),
      ).ok,
    ).toBe(false);
  });
});
