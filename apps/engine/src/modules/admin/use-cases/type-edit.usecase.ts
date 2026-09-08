/**
 * Editing a content type (ADR 0033).
 *
 * The same shape `AutomationEditUseCase` has, for the same reason: every edit
 * produces a whole spec and sends it through `ApplySpecUseCase`, so a type
 * defined in a browser inherits the diff, the history, the undo and the
 * destructive gate without this file knowing they exist.
 *
 * What this deliberately does not edit: `aggregate`, `computed`, `hours`,
 * `derived`, `payment` and `jsonld`. Each needs a shape a form would have to
 * invent an editor for, and each survives an edit here untouched — a field is
 * merged onto rather than rebuilt, so a screen that cannot show a setting
 * cannot drop one either.
 */
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";
import { SiteSpec, type ContentType, type Field } from "@forinda-cms/spec";

import type { Role } from "@/shared/roles";
import { ApplySpecUseCase } from "./apply-spec.usecase";

export interface EditInput {
  readonly actor: string;
  /** What this person may propose — checked once, at the apply (ADR 0041). */
  readonly role: Role;
  /**
   * Dropping a field drops its column, and its data with it. The gate refuses
   * that unless a caller says otherwise — here that is a second press on a
   * screen that has already said what would be lost, never a default.
   */
  readonly allowDestructive?: boolean;
}

export type EditResult = { ok: true; seq: number } | { ok: false; error: string };

/** What the "about this type" form can set. Everything else is left alone. */
export interface TypeSettings {
  readonly label: string;
  readonly labelPlural?: string | undefined;
  readonly titleField?: string | undefined;
  readonly permalink?: string | undefined;
  readonly publishable: boolean;
  readonly submissions?: "visitors" | "anyone" | undefined;
}

/** What the field form can set, on top of the settings every field shares. */
export interface FieldSettings {
  readonly label: string;
  readonly help?: string | undefined;
  readonly required?: boolean;
  readonly unique?: boolean;
  readonly filterable?: boolean;
  /** text */
  readonly max?: number | undefined;
  /** number */
  readonly min?: number | undefined;
  /** asset */
  readonly accept?: string | undefined;
  /** select — `value: Label` per line. */
  readonly options?: string | undefined;
  /** reference */
  readonly to?: string | undefined;
  readonly many?: boolean;
  /** state — one value per line, and `from: to, to` per line. */
  readonly values?: string | undefined;
  readonly initial?: string | undefined;
  readonly transitions?: string | undefined;
}

/**
 * The types a form can create.
 *
 * `aggregate` and `computed` are absent because neither has a starting value
 * that means anything — an aggregate with no source type and a formula with no
 * operands are both invalid, and a builder that creates something invalid is
 * a builder whose next click fails.
 */
const ACCEPTS = ["any", "image", "video", "document"] as const;

export const CREATABLE_FIELD_TYPES = [
  "text",
  "richtext",
  "number",
  "boolean",
  "date",
  "datetime",
  "email",
  "phone",
  "url",
  "asset",
  "geo",
  "select",
  "reference",
  "state",
  "hours",
] as const;

@Service({ scope: Lifetime.REQUEST })
export class TypeEditUseCase {
  constructor(@Inject(ApplySpecUseCase) private readonly applySpec: ApplySpecUseCase) {}

  /**
   * A new type, with one field, because a type with none is not a valid spec.
   *
   * The field is the title: every listing, every reference picker and every
   * permalink needs one, and a type whose first field is called `title` is the
   * shape someone would have typed anyway.
   */
  create(spec: SiteSpec, key: string, label: string, plural: string, input: EditInput) {
    return this.edit(spec, input, (content) => {
      if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(key)) return "Use lowercase words joined by -.";
      if (content.some((t) => t.key === key)) return `There is already a type called "${key}".`;
      if (!label.trim()) return "Give it a name.";

      content.push({
        key,
        label: label.trim(),
        ...(plural.trim() ? { labelPlural: plural.trim() } : {}),
        titleField: "title",
        fields: [{ name: "title", label: "Title", type: "text", required: true }],
      } as ContentType);
      return null;
    });
  }

  update(spec: SiteSpec, key: string, settings: TypeSettings, input: EditInput) {
    return this.edit(spec, input, (content) => {
      const type = content.find((t) => t.key === key);
      if (!type) return "That type no longer exists.";
      if (!settings.label.trim()) return "Give it a name.";

      const next = type as ContentType & Record<string, unknown>;
      next.label = settings.label.trim();
      setOrDelete(next, "labelPlural", settings.labelPlural?.trim());
      setOrDelete(next, "titleField", settings.titleField);
      setOrDelete(next, "permalink", settings.permalink?.trim());
      setOrDelete(next, "submissions", settings.submissions);
      next.publishable = settings.publishable;
      return null;
    });
  }

  /** Removing a type drops its table. Destructive, and gated as such. */
  remove(spec: SiteSpec, key: string, input: EditInput) {
    return this.edit(spec, input, (content) => {
      const at = content.findIndex((t) => t.key === key);
      if (at < 0) return "That type no longer exists.";
      if (content.length === 1) return "A site needs at least one content type.";
      content.splice(at, 1);
      return null;
    });
  }

  addField(
    spec: SiteSpec,
    key: string,
    name: string,
    label: string,
    type: string,
    input: EditInput,
  ) {
    return this.edit(spec, input, (content) => {
      const found = content.find((t) => t.key === key);
      if (!found) return "That type no longer exists.";
      if (!/^[a-z][a-zA-Z0-9]*$/.test(name))
        return "Field names are camelCase, starting with a lowercase letter.";
      if (found.fields.some((f) => f.name === name))
        return `"${found.label}" already has a field called "${name}".`;
      if (!label.trim()) return "Give the field a name.";

      const made = startingField(name, label.trim(), type, content, key);
      if (typeof made === "string") return made;
      found.fields.push(made);
      return null;
    });
  }

  moveField(spec: SiteSpec, key: string, index: number, delta: number, input: EditInput) {
    return this.edit(spec, input, (content) => {
      const type = content.find((t) => t.key === key);
      if (!type) return "That type no longer exists.";
      const to = index + delta;
      if (!type.fields[index] || !type.fields[to]) return "That field is already at the end.";
      const [moved] = type.fields.splice(index, 1);
      type.fields.splice(to, 0, moved!);
      return null;
    });
  }

  removeField(spec: SiteSpec, key: string, name: string, input: EditInput) {
    return this.edit(spec, input, (content) => {
      const type = content.find((t) => t.key === key);
      if (!type) return "That type no longer exists.";
      const at = type.fields.findIndex((f) => f.name === name);
      if (at < 0) return "That field is already gone.";
      if (type.fields.length === 1) return "A type needs at least one field.";
      // The type would still name it as its title, which is not a spec that
      // validates — and the refusal a schema gives for that reads worse than
      // this one does.
      if (type.titleField === name) delete (type as { titleField?: string }).titleField;
      type.fields.splice(at, 1);
      return null;
    });
  }

  /**
   * One field's settings.
   *
   * The existing field is the starting point rather than a blank object, so
   * everything this screen has no control for — an aggregate's source, a
   * computed field's formula — is still there afterwards.
   */
  updateField(
    spec: SiteSpec,
    key: string,
    name: string,
    settings: FieldSettings,
    input: EditInput,
  ) {
    return this.edit(spec, input, (content) => {
      const type = content.find((t) => t.key === key);
      if (!type) return "That type no longer exists.";
      const field = type.fields.find((f) => f.name === name) as
        | (Field & Record<string, unknown>)
        | undefined;
      if (!field) return "That field is already gone.";
      if (!settings.label.trim()) return "Give the field a name.";

      field.label = settings.label.trim();
      setOrDelete(field, "help", settings.help?.trim());

      // `required` and friends are absent from the derived and computed
      // shapes, so they are written only where the schema has somewhere to
      // put them — an extra key is a `.strict()` failure, not a no-op.
      if ("required" in field) field["required"] = settings.required === true;
      if ("unique" in field) field["unique"] = settings.unique === true;
      if ("filterable" in field) field["filterable"] = settings.filterable === true;

      switch (field.type) {
        case "text":
          setOrDelete(field, "max", number(settings.max));
          break;
        case "number":
          setOrDelete(field, "min", number(settings.min));
          setOrDelete(field, "max", number(settings.max));
          break;
        case "asset": {
          // A closed list, checked here rather than trusted from the form: the
          // schema would refuse anything else, but with a message about a union
          // rather than about a file kind.
          const accept = settings.accept ?? "any";
          if (!ACCEPTS.includes(accept as (typeof ACCEPTS)[number]))
            return `"${accept}" is not a kind of file.`;
          field["accept"] = accept as (typeof ACCEPTS)[number];
          break;
        }
        case "select": {
          const options = parseOptions(settings.options ?? "");
          if (options.length === 0) return "A choice field needs at least one option.";
          field["options"] = options;
          break;
        }
        case "reference":
          if (!settings.to) return "Say which type this points at.";
          if (!content.some((t) => t.key === settings.to))
            return `There is no type called "${settings.to}".`;
          field["to"] = settings.to;
          field["many"] = settings.many === true;
          break;
        case "state": {
          const values = lines(settings.values ?? "");
          if (values.length < 2) return "A status needs at least two values.";
          const initial = settings.initial?.trim() || values[0]!;
          if (!values.includes(initial))
            return `"${initial}" is not one of the values, so nothing could start there.`;
          const transitions = parseTransitions(settings.transitions ?? "", values);
          if (typeof transitions === "string") return transitions;
          field["values"] = values;
          field["initial"] = initial;
          field["transitions"] = transitions;
          break;
        }
        default:
          break;
      }
      return null;
    });
  }

  /**
   * One edit: copy the spec, change the copy, validate it, apply it.
   *
   * The copy is what keeps a refused edit from leaving half a type behind for
   * the next click to build on.
   */
  private async edit(
    spec: SiteSpec,
    input: EditInput,
    mutate: (content: ContentType[]) => string | null,
  ): Promise<EditResult> {
    const draft = structuredClone(spec) as SiteSpec & { content: ContentType[] };
    const refusal = mutate(draft.content);
    if (refusal) return { ok: false, error: refusal };

    const validated = SiteSpec.safeParse(draft);
    if (!validated.success) {
      return {
        ok: false,
        error: validated.error.issues[0]?.message ?? "That change is not valid.",
      };
    }

    try {
      const { seq } = await this.applySpec.execute(validated.data, {
        actor: input.actor,
        role: input.role,
        source: "types",
        allowDestructive: input.allowDestructive === true,
      });
      return { ok: true, seq };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/**
 * A field that is valid the moment it is added.
 *
 * The same rule the automation builder follows: adding a thing and configuring
 * it are one apply, so the starting value has to be a legal one. Where there is
 * no legal starting value — a reference on a site with one type, pointing
 * nowhere — this refuses and says why.
 */
function startingField(
  name: string,
  label: string,
  type: string,
  content: readonly ContentType[],
  self: string,
): Field | string {
  const base = { name, label, type };
  switch (type) {
    case "select":
      return { ...base, options: [{ value: "first-choice", label: "First choice" }] } as Field;
    case "reference": {
      const to =
        content.find((t) => t.key !== self && !t.derived) ?? content.find((t) => !t.derived);
      if (!to) return "There is no other type to point at yet.";
      return { ...base, to: to.key } as Field;
    }
    case "state":
      return {
        ...base,
        values: ["new", "done"],
        initial: "new",
        transitions: [{ from: "new", to: ["done"] }],
      } as Field;
    default:
      if (!(CREATABLE_FIELD_TYPES as readonly string[]).includes(type))
        return `"${type}" is not a field type this screen can add.`;
      return base as Field;
  }
}

/** `value: Label` per line, or a bare value that labels itself. */
function parseOptions(text: string): { value: string; label: string }[] {
  return lines(text).map((line) => {
    const at = line.indexOf(":");
    if (at < 0) return { value: line, label: line };
    return { value: line.slice(0, at).trim(), label: line.slice(at + 1).trim() || line };
  });
}

/** `from: to, other` per line — the graph as the rows someone would write. */
function parseTransitions(
  text: string,
  values: readonly string[],
): { from: string; to: string[] }[] | string {
  const rows = lines(text);
  if (rows.length === 0) return "A status needs at least one allowed move.";

  const parsed: { from: string; to: string[] }[] = [];
  for (const row of rows) {
    const at = row.indexOf(":");
    if (at < 0) return `"${row}" needs to read "from: to".`;
    const from = row.slice(0, at).trim();
    const to = row
      .slice(at + 1)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (to.length === 0) return `"${from}" has nowhere to go.`;
    for (const state of [from, ...to]) {
      if (!values.includes(state)) return `"${state}" is not one of the values.`;
    }
    parsed.push({ from, to });
  }
  return parsed;
}

const lines = (text: string): string[] =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

const number = (value: number | undefined): number | undefined =>
  value === undefined || Number.isNaN(value) ? undefined : value;

/**
 * Optional means absent, not empty.
 *
 * `permalink: ""` is not a shorter way of saying "no permalink" — the schema
 * refuses it, so clearing a box has to delete the key rather than blank it.
 */
function setOrDelete(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined || value === "") delete target[key];
  else target[key] = value;
}
