/**
 * Validating an entry against its content type.
 *
 * Doc 03 §2 accepted a real cost when it chose `jsonb` over EAV: *"database-level
 * type enforcement and foreign key constraints are not applicable to data within
 * JSONB — validation usually occurs at the application layer."* This is that
 * layer, and it is the only thing standing between a declared content model and
 * whatever a form, an API call or a model decided to send.
 *
 * Built from the same field declarations the renderer reads and the admin
 * generates its inputs from, so a type change moves all three at once.
 */
import { z } from "zod";

import type { ContentType, Field } from "./content.js";

/**
 * A Zod schema for one field.
 *
 * Optional fields accept an empty string as absent, because that is what an
 * HTML form sends for a field nobody filled in — treating it as a value would
 * make every optional text field fail its own type.
 */
function schemaForField(field: Field): z.ZodType {
  const required = "required" in field && field.required === true;

  const base = ((): z.ZodType => {
    switch (field.type) {
      case "text":
      case "richtext": {
        // A required text field must reject `""`. An empty box is exactly what
        // `required` exists to catch, and a bare `z.string()` accepts it — so
        // saving an entry with every text field blank succeeded, and the form
        // that submitted nothing got a 303.
        let t = required ? z.string().min(1, "This is required.") : z.string();
        if ("max" in field && typeof field.max === "number") t = t.max(field.max);
        return t;
      }
      case "email":
        return z.email();
      case "url":
        return z.url();
      case "phone":
        // Deliberately loose. Phone formats vary by country far more than a
        // regex can honestly capture, and rejecting a real number is worse than
        // accepting a malformed one — doc 14's market dials +254 and 07xx alike.
        return z.string().min(3).max(32);
      case "number": {
        let n: z.ZodNumber = z.number();
        if ("min" in field && typeof field.min === "number") n = n.min(field.min);
        if ("max" in field && typeof field.max === "number") n = n.max(field.max);
        return n;
      }
      case "boolean":
        return z.boolean();
      case "date":
      case "datetime":
        return z.iso.datetime({ offset: true }).or(z.iso.date());
      case "select":
        return z.enum(
          ("options" in field ? field.options : []).map((o) => o.value) as [string, ...string[]],
        );
      case "asset":
        return z.string().regex(/^asset:/);
      case "reference":
        return z.string().regex(/^ref:/);
      case "state":
        return z.enum(("values" in field ? field.values : []) as [string, ...string[]]);
      case "aggregate":
      case "computed":
        // Worked out by the engine, never written by a form or an API caller:
        // accepting one would let a caller claim their own rating, or their own
        // total price.
        return z.never();
      case "hours":
        // The shape is declared by the field type itself, so it validates
        // structurally rather than as opaque JSON.
        return z.record(
          z.string(),
          z.array(z.object({ from: z.string(), to: z.string() }).strict()),
        );
    }
  })();

  return required
    ? base
    : base
        .optional()
        .or(z.literal(""))
        .transform((v) => (v === "" ? undefined : v));
}

/**
 * The schema for one content type's `data`.
 *
 * `strict()` so a field nobody declared is rejected rather than stored. A
 * silently-accepted extra key is how a typo becomes invisible data that no
 * form shows and no migration knows about.
 */
export function entrySchemaFor(type: ContentType): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodType> = {};
  for (const field of type.fields) shape[field.name] = schemaForField(field);
  return z.object(shape).strict() as unknown as z.ZodType<Record<string, unknown>>;
}

/**
 * Coerce what an HTML form sends into what the schema expects.
 *
 * Every form value arrives as a string, so a number field sends `"1500"` and an
 * unchecked box sends nothing at all. Doing this here rather than in the admin
 * means an API or an MCP tool posting form-shaped data gets the same treatment.
 */
export function coerceEntryInput(
  type: ContentType,
  input: Record<string, unknown>,
): Record<string, unknown> {
  // Unknown keys are carried through rather than dropped, so `.strict()` can
  // reject them. Filtering here instead would silently accept a typo'd field
  // name and make the strict schema decorative.
  const out: Record<string, unknown> = { ...input };
  for (const field of type.fields) {
    const raw = input[field.name];
    switch (field.type) {
      case "number":
        out[field.name] = raw === "" || raw === undefined ? undefined : Number(raw);
        break;
      case "boolean":
        // An unchecked checkbox sends nothing; absent means false, not missing.
        out[field.name] = raw === "on" || raw === "true" || raw === true;
        break;
      case "state":
        // A declared `initial` that nothing writes is decoration: the row lands
        // with no status, listings show a blank column, and an automation that
        // moves it along a transition has nothing to move *from* — which is how
        // this was found (ADR 0024).
        out[field.name] = raw === "" || raw === undefined ? field.initial : raw;
        break;
      default:
        out[field.name] = raw;
    }
  }
  return out;
}

export interface EntryValidation {
  readonly ok: boolean;
  readonly data?: Record<string, unknown>;
  /** Field name → message, so a form can show each error where it belongs. */
  readonly errors?: Record<string, string>;
}

export function validateEntry(type: ContentType, input: Record<string, unknown>): EntryValidation {
  const parsed = entrySchemaFor(type).safeParse(coerceEntryInput(type, input));
  if (parsed.success) return { ok: true, data: parsed.data };

  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "_");
    errors[key] ??= issue.message;
  }
  return { ok: false, errors };
}
