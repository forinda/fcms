/**
 * Content types — the `content` section of ADR 0001.
 *
 * Fields are declared, which is what lets the deterministic migration planner
 * diff a desired shape against the current one and classify the difference
 * (doc 03). It is also what makes doc 08's structured-data claim possible:
 * because the type says it is an Event, the JSON-LD is generated rather than
 * guessed, which is the thing WordPress structurally cannot do.
 */
import { z } from "zod";

import { FieldName, Key, Label, Note, TemplateString } from "./primitives.js";

/**
 * A weekly opening-hours field.
 *
 * Added because the salon spec needed somewhere to put a stylist's working
 * hours, and the tempting answer was a generic `json` field. That would have
 * worked and been wrong: arbitrary JSON is unvalidated structure the AI cannot
 * reason about and the panel cannot render — precisely the escape hatch ADR 0001
 * exists to refuse. A declared shape is the same information with none of that.
 *
 * Useful past bookings, too: a restaurant's opening hours are the same field.
 */
const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;

export const HoursField = z
  .object({
    type: z.literal("hours"),
    required: z.boolean().default(false),
    help: Label.optional(),
    note: Note,
  })
  .strict();

export const WeekHours = z
  .object({
    mon: z
      .array(z.object({ from: z.string().regex(TIME), to: z.string().regex(TIME) }).strict())
      .optional(),
    tue: z
      .array(z.object({ from: z.string().regex(TIME), to: z.string().regex(TIME) }).strict())
      .optional(),
    wed: z
      .array(z.object({ from: z.string().regex(TIME), to: z.string().regex(TIME) }).strict())
      .optional(),
    thu: z
      .array(z.object({ from: z.string().regex(TIME), to: z.string().regex(TIME) }).strict())
      .optional(),
    fri: z
      .array(z.object({ from: z.string().regex(TIME), to: z.string().regex(TIME) }).strict())
      .optional(),
    sat: z
      .array(z.object({ from: z.string().regex(TIME), to: z.string().regex(TIME) }).strict())
      .optional(),
    sun: z
      .array(z.object({ from: z.string().regex(TIME), to: z.string().regex(TIME) }).strict())
      .optional(),
  })
  .strict();
export type WeekHours = z.infer<typeof WeekHours>;

/**
 * A `state` field (ADR 0009 §4) — declared transitions, so "guide transitions"
 * is a declaration rather than a workflow somebody codes. Illegal transitions
 * are refused by the platform, and `logic` can trigger on `entry.transitioned`.
 */
export const StateField = z
  .object({
    type: z.literal("state"),
    initial: Key,
    values: z.array(Key).min(2),
    transitions: z.array(z.object({ from: Key, to: z.array(Key).min(1) }).strict()).min(1),
  })
  .strict()
  .superRefine((f, ctx) => {
    const known = new Set(f.values);
    if (!known.has(f.initial)) {
      ctx.addIssue({ code: "custom", message: `initial state "${f.initial}" is not in values` });
    }
    for (const t of f.transitions) {
      for (const name of [t.from, ...t.to]) {
        if (!known.has(name)) {
          ctx.addIssue({
            code: "custom",
            message: `transition references unknown state "${name}"`,
          });
        }
      }
    }
  });

const scalarField = <T extends string>(type: T) =>
  z
    .object({
      type: z.literal(type),
      required: z.boolean().default(false),
      unique: z.boolean().default(false),
      /** Marks the field for a generated column + index (doc 03 §2). */
      filterable: z.boolean().default(false),
      help: Label.optional(),
      note: Note,
    })
    .strict();

/**
 * A number computed from rows of another type (ADR 0019 §4).
 *
 * A hotel's rating is the average of its reviews' scores, and its review count
 * is how many there are. Both are facts about the hotel that live in another
 * table, and both are things a visitor sorts and filters by — so they are
 * **fields**, computed by the engine, rather than arithmetic in a template.
 *
 * Declared rather than computed in the page for three reasons: it can be
 * indexed, it can be sorted and filtered like any other field, and it appears
 * in the diff when it changes. A `{{ }}` that averaged a list would be none of
 * those, and would be an expression language (ADR 0001).
 */
export const AggregateField = scalarField("aggregate").extend({
  /** The type holding the rows — `review`. */
  of: Key,
  /** The reference field on that type pointing back here — `hotel`. */
  on: FieldName,
  /** Which of its fields to aggregate. Omitted for `count`. */
  field: FieldName.optional(),
  fn: z.enum(["count", "avg", "sum", "min", "max"]),
  /** Rounding for `avg`, because "8.4" reads and "8.399999" does not. */
  precision: z.number().int().min(0).max(4).default(1),
});

/**
 * An operand: this row's field, a request parameter, or a number.
 *
 * Three kinds and no more. Every one of them is inspectable — you can read a
 * formula and say what it depends on without running it, which is what makes it
 * migratable and proposable by a model.
 */
export const Operand: z.ZodType<Operand> = z.lazy(() =>
  z.union([
    z.object({ field: FieldName }).strict(),
    z
      .object({ param: z.string().regex(/^[a-z][a-z0-9_]*$/), default: z.number().optional() })
      .strict(),
    z.object({ value: z.number() }).strict(),
    Formula,
  ]),
);

export type Operand =
  | { field: string }
  | { param: string; default?: number }
  | { value: number }
  | Formula;

/**
 * Arithmetic, as a declared tree (ADR 0019 §5).
 *
 * ADR 0001 forbids `{{ nights * rate }}` and that stays forbidden: a template
 * is a lookup. But "three nights, 4,500 total" is not optional for a booking
 * site, so the ceiling rises in exactly one place — a **field** with a
 * **declared formula** over a closed set of operations.
 *
 * The difference from an expression language is the difference the whole spec
 * turns on: this is data. It diffs, it validates, the canvas can show it, and
 * the planner can see that it is computed rather than stored. `a * b` in a
 * string is none of those.
 */
export const Formula: z.ZodType<Formula> = z.lazy(() =>
  z
    .object({
      op: z.enum(["add", "subtract", "multiply", "divide", "min", "max", "round"]),
      of: z.array(Operand).min(1).max(8),
    })
    .strict(),
);

export type Formula = {
  op: "add" | "subtract" | "multiply" | "divide" | "min" | "max" | "round";
  of: Operand[];
};

/**
 * A number this type works out for itself.
 *
 * Computed on read like an aggregate, never written, and available to sort and
 * filter by — a "total price" you cannot order by is not much of a total.
 */
export const ComputedField = scalarField("computed").extend({
  formula: Formula,
  /** Decimal places. Money is 2; a night count is 0. */
  precision: z.number().int().min(0).max(4).default(0),
});

export const Field = z.intersection(
  z.object({ name: FieldName, label: Label }),
  z.union([
    scalarField("text").extend({ max: z.number().int().positive().optional() }),
    scalarField("richtext"),
    scalarField("number").extend({ min: z.number().optional(), max: z.number().optional() }),
    scalarField("boolean"),
    scalarField("date"),
    scalarField("datetime"),
    scalarField("email"),
    scalarField("phone"),
    scalarField("url"),
    scalarField("asset").extend({
      accept: z.enum(["image", "video", "document", "any"]).default("any"),
    }),
    /**
     * One coordinate (ADR 0026).
     *
     * A point, not a shape: the businesses this platform is for have an
     * address, not a boundary, and a polygon is a different storage and query
     * story. Validated to the ranges that exist rather than accepted as two
     * numbers, because a swapped pair puts a Nairobi salon in the Indian Ocean
     * and nothing downstream would notice.
     */
    scalarField("geo"),
    scalarField("select").extend({
      options: z.array(z.object({ value: Key, label: Label })).min(1),
    }),
    /** A relation to another content type. Integrity is declared, not implied. */
    scalarField("reference").extend({ to: Key, many: z.boolean().default(false) }),
    StateField,
    HoursField,
    AggregateField,
    ComputedField,
  ]),
);
export type Field = z.infer<typeof Field>;

/**
 * schema.org mapping — set once at type-definition time, so every entry emits
 * correct structured data forever (doc 08). The AI can propose this when it
 * creates the type: "this looks like an Event; I'll mark it up as one."
 */
export const JsonLdMapping = z
  .object({
    type: z.enum([
      "Article",
      "BlogPosting",
      "Event",
      "Product",
      "Service",
      "LocalBusiness",
      "Person",
      "Organization",
      "Recipe",
      "JobPosting",
      "FAQPage",
      "Review",
    ]),
    /** schema.org property → field name on this type. */
    properties: z.record(z.string(), FieldName),
  })
  .strict();

/**
 * A **derived** content type: rows computed by the platform, not stored.
 *
 * The insight from ADR 0014: availability is not a new kind of query, it is a
 * content type whose rows are calculated. So `data`, `where`, `sort` and `limit`
 * work on it unchanged, and the renderer cannot tell the difference — a derived
 * type is an `EntrySource` that computes instead of reads.
 *
 * The spec declares **inputs**; the platform owns the **algorithm**. That is the
 * same split `flow` already uses, which is why this is a precedent being
 * followed rather than an exception carved. `kind` comes from a fixed registry,
 * exactly like blocks and actions.
 *
 * What must stay excluded: an author-supplied algorithm, or any expression that
 * computes a row. A rule `schedule` cannot express is a plugin, not a construct.
 */
export const ScheduleSource = z
  .object({
    kind: z.literal("schedule"),
    /** Who or what is being booked, and where their working hours live. */
    resource: z.object({ type: Key, hours: FieldName }).strict(),
    /** What occupies time, and how to read a booking's span from it. */
    occupied: z
      .object({ type: Key, resource: FieldName, start: FieldName, minutes: FieldName })
      .strict(),
    slot: z
      .object({
        minutes: z.number().int().min(1).max(1440),
        buffer: z.number().int().min(0).default(0),
      })
      .strict(),
    window: z
      .object({
        days: z.number().int().min(1).max(365),
        leadTime: z
          .object({ hours: z.number().int().min(0) })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

/**
 * `stay` — is this free for every night between two dates? (ADR 0025)
 *
 * The other shape of availability. `schedule` answers "which start times exist";
 * this answers "which of these is free for a span", which is what a hotel, a
 * rental, a hire company and a workshop space all ask. Modelling it with
 * `schedule` would mean a row per night and a page working out whether the set
 * is contiguous — an algorithm in a template, which ADR 0006 exists to prevent.
 *
 * The same split as every derived type: the spec declares the inputs, the
 * platform owns the algorithm.
 */
export const StaySource = z
  .object({
    kind: z.literal("stay"),
    /** What is booked — a room, a cottage, a van. */
    resource: z.object({ type: Key }).strict(),
    /** What occupies it, and where a booking's nights are read from. */
    occupied: z.object({ type: Key, resource: FieldName, from: FieldName, to: FieldName }).strict(),
    /**
     * The request parameters the visitor's dates arrive in.
     *
     * Declared, so the `filters` block can render the two inputs with the right
     * names rather than an author guessing them (ADR 0025 §6).
     */
    range: z.object({ from: Key, to: Key }).strict(),
    /** How far ahead this may be asked about. */
    window: z.object({ days: z.number().int().min(1).max(1095) }).strict(),
  })
  .strict();

export const DerivedSource = z.discriminatedUnion("kind", [ScheduleSource, StaySource]);
export type DerivedSource = z.infer<typeof DerivedSource>;

/**
 * What it costs to create a row of this type (ADR 0023).
 *
 * The spec declares **inputs** — where the amount comes from, in what currency,
 * through which declared integration — and the platform owns everything that
 * touches money: the conversion to minor units, the state machine, the
 * provider call, and what a callback is allowed to change.
 *
 * There is deliberately no `status` here and no way to express one. A spec that
 * could say `paid` would be an editor with write access to the ledger.
 */
export const Payment = z
  .object({
    /**
     * `field` reads the amount from the entry that was just written; `fixed` is
     * the same price every time, in **minor units** (25000 = KSh 250.00).
     *
     * Never from the request. A form that posts an amount is a form that lets
     * someone pay 1 for a 15,000 booking, and that is the default shape of a
     * naive integration.
     */
    amount: z.union([
      /**
       * A field on the row, or a field on something the row references —
       * `service.deposit`.
       *
       * A price often lives on the thing that was chosen rather than on the
       * order: a salon's deposit belongs to the service, and a booking that
       * had to copy it would be a number a form could carry, which is the
       * hole §3 exists to close. One level, because a price two references
       * away is a query, not a path.
       */
      z
        .object({ field: FieldName.or(z.string().regex(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/)) })
        .strict(),
      z.object({ fixed: z.number().int().positive() }).strict(),
    ]),
    /** ISO 4217, uppercase. Money is an integer of these units, never a float. */
    currency: z.string().regex(/^[A-Z]{3}$/, "an ISO currency code, e.g. KES"),
    /** The `wiring` integration that takes it — `manual`, an M-Pesa till, a card processor. */
    via: Key,
    /** What the payment is for, shown to the person paying. */
    label: Label.optional(),
  })
  .strict();

export type Payment = z.infer<typeof Payment>;

export const ContentType = z
  .object({
    key: Key,
    label: Label,
    /** Plural label — the admin needs it and guessing English plurals is a bug factory. */
    labelPlural: Label.optional(),
    /**
     * Who may create rows of this type from the public site (ADR 0020 §3).
     *
     *   - absent   — nobody; the admin, the CLI and MCP only. The default,
     *                because a type that accepts public writes should say so.
     *   - visitors — a signed-in visitor. Reviews.
     *   - anyone   — no account needed. Enquiries and contact forms.
     *
     * Declared here rather than inferred from a form, so turning a type into a
     * public write target is a spec change that appears in the diff and can be
     * refused by the destructive gate — not a side effect of adding a block to
     * a page.
     */
    submissions: z.enum(["visitors", "anyone"]).optional(),

    /** Which field renders as the row's title in listings and references. */
    titleField: FieldName.optional(),
    fields: z.array(Field).min(1),
    /** URL shape for entries of this type, e.g. `/services/{{ entry.slug }}` (doc 08). */
    permalink: TemplateString.optional(),
    jsonld: JsonLdMapping.optional(),
    /** Entries can be drafted and published; some types (settings-like) cannot. */
    publishable: z.boolean().default(true),
    /**
     * Computed rather than stored (ADR 0014). A derived type is read-only:
     * writing to one must fail with a clear message rather than silently
     * doing nothing.
     */
    derived: DerivedSource.optional(),
    /** Creating a row of this type is charged for (ADR 0023). */
    payment: Payment.optional(),
    note: Note,
  })
  .strict()
  .superRefine((t, ctx) => {
    const names = t.fields.map((f) => f.name);
    for (const dup of names.filter((n, i) => names.indexOf(n) !== i)) {
      ctx.addIssue({ code: "custom", message: `duplicate field "${dup}" on type "${t.key}"` });
    }
    if (t.payment && "field" in t.payment.amount) {
      const named = (t.payment.amount as { field: string }).field;
      // A path is checked where the whole document is available, in
      // `checkReferences` — this schema knows one type at a time.
      if (named.includes(".")) return;
      const field = t.fields.find((f) => f.name === named);
      // A price that is not a number is a price that cannot be charged, and the
      // failure would otherwise happen at the till rather than at the edit.
      if (!field) {
        ctx.addIssue({
          code: "custom",
          message: `payment reads "${named}", which "${t.key}" does not have`,
        });
      } else if (field.type !== "number" && field.type !== "computed") {
        ctx.addIssue({
          code: "custom",
          message: `payment reads "${field.name}", which is a ${field.type} — an amount has to be a number`,
        });
      }
    }
    if (t.payment && t.derived) {
      ctx.addIssue({
        code: "custom",
        message: `"${t.key}" is derived, so its rows are computed and cannot be paid for`,
      });
    }
    if (t.titleField && !names.includes(t.titleField)) {
      ctx.addIssue({
        code: "custom",
        message: `titleField "${t.titleField}" is not a field of "${t.key}"`,
      });
    }
  });

export type ContentType = z.infer<typeof ContentType>;
