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
    scalarField("select").extend({
      options: z.array(z.object({ value: Key, label: Label })).min(1),
    }),
    /** A relation to another content type. Integrity is declared, not implied. */
    scalarField("reference").extend({ to: Key, many: z.boolean().default(false) }),
    StateField,
    HoursField,
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

export const DerivedSource = z.discriminatedUnion("kind", [ScheduleSource]);
export type DerivedSource = z.infer<typeof DerivedSource>;

export const ContentType = z
  .object({
    key: Key,
    label: Label,
    /** Plural label — the admin needs it and guessing English plurals is a bug factory. */
    labelPlural: Label.optional(),
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
    note: Note,
  })
  .strict()
  .superRefine((t, ctx) => {
    const names = t.fields.map((f) => f.name);
    for (const dup of names.filter((n, i) => names.indexOf(n) !== i)) {
      ctx.addIssue({ code: "custom", message: `duplicate field "${dup}" on type "${t.key}"` });
    }
    if (t.titleField && !names.includes(t.titleField)) {
      ctx.addIssue({
        code: "custom",
        message: `titleField "${t.titleField}" is not a field of "${t.key}"`,
      });
    }
  });

export type ContentType = z.infer<typeof ContentType>;
