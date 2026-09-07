/**
 * The type builder (ADR 0033).
 *
 * Plain forms, server-rendered, one apply per press. The canvas earns its
 * JavaScript by showing the page as it will look; defining a field has nothing
 * to preview, so this is the shape that already works everywhere: labelled
 * controls, real buttons, no focus to manage and nothing to restore after a
 * failed save.
 *
 * There is no per-field-type form in here beyond the settings each type
 * actually has — everything else on a field (a formula, an aggregate's source)
 * is left alone rather than rendered as JSON someone can break.
 */
import type { ContentType, Field, SiteSpec } from "@forinda-cms/spec";

import { CREATABLE_FIELD_TYPES } from "../use-cases/type-edit.usecase";
import { esc } from "./view";

/**
 * A refusal, and what it would take to go ahead.
 *
 * The gate writes its message as lines — a heading and one bullet per thing
 * that would be lost — so they are rendered as lines. Collapsed into a
 * paragraph, "3 destructive changes" reads as a wall, and the counts are the
 * part somebody has to actually read before pressing the second button.
 */
const alert = (error?: string, offer = "") => {
  if (!error) return "";
  const lines = error
    .split("\n")
    .map((line) => line.trim().replace(/^- /, ""))
    .filter(Boolean);
  return `<div class="error" role="alert">${lines
    .map((line) => `<p>${esc(line)}</p>`)
    .join("")}${offer}</div>`;
};

export interface TypeListOptions {
  readonly spec: SiteSpec;
  readonly counts: Record<string, number>;
  readonly error?: string | undefined;
}

export function typeList({ spec, counts, error }: TypeListOptions): string {
  const row = (t: ContentType) => `<tr>
  <td><a href="/admin/types/${esc(t.key)}">${esc(t.label)}</a>${
    t.derived ? ' <span class="pill">computed</span>' : ""
  }</td>
  <td class="muted"><code>${esc(t.key)}</code></td>
  <td class="muted">${t.fields.length} ${t.fields.length === 1 ? "field" : "fields"}</td>
  <td class="muted">${counts[t.key] ?? 0} ${(counts[t.key] ?? 0) === 1 ? "entry" : "entries"}</td>
</tr>`;

  return `${alert(error)}
<h1>Content types</h1>
<p class="muted">What this site stores, and what each one holds. Changing a type
changes the database underneath it, so every edit here is written to history and
can be undone.</p>

<table>
  <caption class="sr-only">Content types on this site</caption>
  <thead><tr><th scope="col">Type</th><th scope="col">Key</th><th scope="col">Shape</th><th scope="col">Rows</th></tr></thead>
  <tbody>${spec.content.map(row).join("")}</tbody>
</table>

<form method="post" action="/admin/types" class="new-type">
  <h2>Add a type</h2>
  <div class="field">
    <label for="t-key">Key</label>
    <input id="t-key" name="key" required pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*"
      aria-describedby="t-key-help">
    <p class="help" id="t-key-help">Lowercase words joined by hyphens — <code>menu-item</code>.
      It appears in addresses and cannot be changed later.</p>
  </div>
  <div class="field">
    <label for="t-label">Name</label>
    <input id="t-label" name="label" required aria-describedby="t-label-help">
    <p class="help" id="t-label-help">What one of them is called — “Menu item”.</p>
  </div>
  <div class="field">
    <label for="t-plural">Name for several</label>
    <input id="t-plural" name="labelPlural" aria-describedby="t-plural-help">
    <p class="help" id="t-plural-help">Optional — “Menu items”.</p>
  </div>
  <div class="actions"><button type="submit">Add this type</button></div>
</form>`;
}

export interface TypeBuilderOptions {
  readonly spec: SiteSpec;
  readonly type: ContentType;
  readonly entries: number;
  /** The field the panel is editing, by name. */
  readonly selected: string | null;
  readonly error?: string | undefined;
  /**
   * What a second press would go ahead with — `field:<name>` or `type`.
   *
   * Set by the refusal that produced it, never by the page itself, so the only
   * way to reach a delete that goes through is to have read what it costs.
   */
  readonly confirm?: string | undefined;
}

export function typeBuilder(options: TypeBuilderOptions): string {
  const { spec, type, entries, selected, error, confirm } = options;
  const field = type.fields.find((f) => f.name === selected);
  const doomed = confirm?.startsWith("field:")
    ? type.fields.find((f) => f.name === confirm.slice("field:".length))
    : undefined;

  const offer = doomed
    ? `<form method="post" action="/admin/types/${esc(type.key)}/fields">
  <input type="hidden" name="op" value="del:${esc(doomed.name)}">
  <input type="hidden" name="confirm" value="field:${esc(doomed.name)}">
  <button type="submit" class="destructive">Yes, remove ${esc(doomed.label)}</button>
</form>`
    : confirm === "type"
      ? `<form method="post" action="/admin/types/${esc(type.key)}/delete">
  <input type="hidden" name="confirm" value="type">
  <button type="submit" class="destructive">Yes, delete ${esc(type.label)} and its ${entries}
    ${entries === 1 ? "row" : "rows"}</button>
</form>`
      : "";

  const list = type.fields
    .map(
      (f, i) => `<li>
  <div class="node${f.name === selected ? " selected" : ""}">
    <a href="?field=${encodeURIComponent(f.name)}"${f.name === selected ? ' aria-current="true"' : ""}>
      ${esc(f.label)} <span class="pill">${esc(f.type)}</span>
    </a>
    <span class="node-actions">
      <button form="field-ops" name="op" value="up:${i}" aria-label="Move ${esc(f.label)} up">
        <span aria-hidden="true">↑</span></button>
      <button form="field-ops" name="op" value="down:${i}" aria-label="Move ${esc(f.label)} down">
        <span aria-hidden="true">↓</span></button>
      <button form="field-ops" name="op" value="del:${esc(f.name)}" class="destructive"
        aria-label="Remove ${esc(f.label)}"><span aria-hidden="true">✕</span></button>
    </span>
  </div>
</li>`,
    )
    .join("");

  return `${alert(error, offer)}
<h1>${esc(type.label)}</h1>
<p class="muted"><code>${esc(type.key)}</code> · ${entries} ${entries === 1 ? "entry" : "entries"} ·
  <a href="/admin/content/${esc(type.key)}">see the entries</a></p>
${
  type.derived
    ? `<p class="warn">These rows are worked out by the platform rather than stored,
       so their shape is fixed here.</p>`
    : ""
}

<div class="builder">
  <section class="tree" aria-labelledby="fields-heading">
    <h2 id="fields-heading">Fields</h2>
    <ol class="blocks">${list}</ol>

    <form method="post" action="/admin/types/${esc(type.key)}/fields" id="field-ops"
      class="add">
      <h3>Add a field</h3>
      <div class="field">
        <label for="new-name">Name</label>
        <input id="new-name" name="name" pattern="[a-z][a-zA-Z0-9]*" aria-describedby="new-name-help">
        <p class="help" id="new-name-help">camelCase — <code>phoneNumber</code>. Fixed once added.</p>
      </div>
      <div class="field">
        <label for="new-label">Label</label>
        <input id="new-label" name="label">
      </div>
      <div class="field">
        <label for="new-type">Holds</label>
        <select id="new-type" name="type">
          ${CREATABLE_FIELD_TYPES.map(
            (t) => `<option value="${t}">${esc(FIELD_TYPE_WORDS[t] ?? t)}</option>`,
          ).join("")}
        </select>
      </div>
      <button name="op" value="add" type="submit">Add this field</button>
    </form>
  </section>

  <section class="panel" aria-labelledby="field-heading">
    ${
      field
        ? fieldForm(type, field, spec)
        : `<h2 id="field-heading">Edit a field</h2>
    <p class="help">Choose one on the left, and its settings appear here.</p>`
    }
  </section>
</div>

<h2>About this type</h2>
<form method="post" action="/admin/types/${esc(type.key)}">
  <div class="field">
    <label for="a-label">Name</label>
    <input id="a-label" name="label" value="${esc(type.label)}" required>
  </div>
  <div class="field">
    <label for="a-plural">Name for several</label>
    <input id="a-plural" name="labelPlural" value="${esc(type.labelPlural ?? "")}">
  </div>
  <div class="field">
    <label for="a-title">Shown as the title</label>
    <select id="a-title" name="titleField" aria-describedby="a-title-help">
      <option value="">—</option>
      ${type.fields
        .map(
          (f) =>
            `<option value="${esc(f.name)}"${f.name === type.titleField ? " selected" : ""}>${esc(f.label)}</option>`,
        )
        .join("")}
    </select>
    <p class="help" id="a-title-help">Which field names a row in listings and pickers.</p>
  </div>
  <div class="field">
    <label for="a-permalink">Address of one entry</label>
    <input id="a-permalink" name="permalink" value="${esc(type.permalink ?? "")}"
      aria-describedby="a-permalink-help">
    <p class="help" id="a-permalink-help">Optional — <code>/services/{{ entry.slug }}</code>.
      Leave empty if entries have no page of their own.</p>
  </div>
  <div class="field">
    <label for="a-submissions">Who may add one from the site</label>
    <select id="a-submissions" name="submissions" aria-describedby="a-submissions-help">
      <option value=""${type.submissions ? "" : " selected"}>Nobody — the admin only</option>
      <option value="visitors"${type.submissions === "visitors" ? " selected" : ""}>Signed-in visitors</option>
      <option value="anyone"${type.submissions === "anyone" ? " selected" : ""}>Anyone</option>
    </select>
    <p class="help" id="a-submissions-help">Opening a type to the public is a change
      that shows up in history.</p>
  </div>
  <div class="field checkbox">
    <input id="a-publishable" name="publishable" type="checkbox"${type.publishable === false ? "" : " checked"}>
    <label for="a-publishable">Entries can be drafted before they are published</label>
  </div>
  <div class="actions"><button type="submit">Save</button></div>
</form>

<form method="post" action="/admin/types/${esc(type.key)}/delete" class="danger">
  <h2>Delete this type</h2>
  <p class="help">Its ${entries} ${entries === 1 ? "row goes" : "rows go"} with it. You are asked
    to confirm, and history keeps a record either way, so this can be undone from there.</p>
  <button type="submit" class="destructive">Delete ${esc(type.label)}</button>
</form>`;
}

/** What each field type holds, said the way somebody choosing one would say it. */
const FIELD_TYPE_WORDS: Record<string, string> = {
  text: "text — a line of writing",
  richtext: "long text — paragraphs",
  number: "a number",
  boolean: "yes or no",
  date: "a date",
  datetime: "a date and a time",
  email: "an email address",
  phone: "a phone number",
  url: "a web address",
  asset: "a file — image, video or document",
  geo: "a place on the map",
  select: "one of a few choices",
  reference: "a link to another entry",
  state: "a status that moves between values",
  hours: "opening hours, by day",
  aggregate: "a number counted from other rows",
  computed: "a number worked out from other fields",
};

/**
 * One field's settings.
 *
 * Only what the schema gives this field. A `state` has no `required`, an
 * `aggregate` has no options, and rendering the union's whole surface for every
 * field would be a form that offers settings the save then refuses.
 */
function fieldForm(type: ContentType, field: Field, spec: SiteSpec): string {
  const f = field as Field & Record<string, unknown>;
  const has = (key: string) => key in f;
  const value = (key: string) => (f[key] === undefined ? "" : String(f[key]));

  const shared = `<div class="field">
  <label for="f-label">Label</label>
  <input id="f-label" name="label" value="${esc(field.label)}" required>
</div>
<div class="field">
  <label for="f-help">Help text</label>
  <input id="f-help" name="help" value="${esc(value("help"))}" aria-describedby="f-help-help">
  <p class="help" id="f-help-help">Shown under the input when someone fills this in.</p>
</div>`;

  const flags = [
    has("required")
      ? checkbox(
          "required",
          "Required",
          f["required"] === true,
          "An entry cannot be saved without it.",
        )
      : "",
    has("unique")
      ? checkbox("unique", "No two entries may share a value", f["unique"] === true)
      : "",
    has("filterable")
      ? checkbox(
          "filterable",
          "Searchable and sortable",
          f["filterable"] === true,
          "Gives it an index, so a page can filter and order by it.",
        )
      : "",
  ]
    .filter(Boolean)
    .join("");

  const specific = ((): string => {
    switch (field.type) {
      case "text":
        return numberInput("max", "Longest allowed", value("max"), "In characters. Optional.");
      case "number":
        return (
          numberInput("min", "Smallest allowed", value("min")) +
          numberInput("max", "Largest allowed", value("max"))
        );
      case "asset":
        return select("accept", "What kind of file", value("accept") || "any", [
          ["any", "Anything"],
          ["image", "Images"],
          ["video", "Video"],
          ["document", "Documents"],
        ]);
      case "select": {
        const options = (f["options"] as { value: string; label: string }[] | undefined) ?? [];
        return textarea(
          "options",
          "Choices",
          options.map((o) => (o.value === o.label ? o.value : `${o.value}: ${o.label}`)).join("\n"),
          "One per line. Write <code>value: Label</code> to show something different from what is stored.",
        );
      }
      case "reference":
        return (
          select(
            "to",
            "Points at",
            value("to"),
            spec.content.filter((t) => !t.derived).map((t) => [t.key, t.label]),
          ) + checkbox("many", "An entry may link to several", f["many"] === true)
        );
      case "state": {
        const values = (f["values"] as string[] | undefined) ?? [];
        const transitions =
          (f["transitions"] as { from: string; to: string[] }[] | undefined) ?? [];
        return (
          textarea("values", "Values", values.join("\n"), "One per line, lowercase.") +
          textInput(
            "initial",
            "New entries start at",
            value("initial"),
            "Which value a new entry gets. Must be one of the values above.",
          ) +
          textarea(
            "transitions",
            "Allowed moves",
            transitions.map((t) => `${t.from}: ${t.to.join(", ")}`).join("\n"),
            "One per line, as <code>from: to, other</code>. Anything not listed is refused.",
          )
        );
      }
      case "aggregate":
      case "computed":
      case "hours":
        return `<p class="help">How this one is worked out is declared in the spec —
          the assistant or <code>fcms</code> changes it. Its label and help text are editable here.</p>`;
      default:
        return "";
    }
  })();

  return `<h2 id="field-heading">${esc(field.label)}</h2>
<p class="help"><code>${esc(field.name)}</code> · ${esc(FIELD_TYPE_WORDS[field.type] ?? field.type)}</p>
<form method="post" action="/admin/types/${esc(type.key)}/field" class="inspector">
  <input type="hidden" name="field" value="${esc(field.name)}">
  ${shared}${flags}${specific}
  <div class="actions"><button type="submit">Save this field</button></div>
</form>`;
}

function textInput(name: string, label: string, value: string, help?: string): string {
  return `<div class="field">
  <label for="f-${name}">${esc(label)}</label>
  <input id="f-${name}" name="${name}" value="${esc(value)}"${help ? ` aria-describedby="f-${name}-help"` : ""}>
  ${help ? `<p class="help" id="f-${name}-help">${help}</p>` : ""}
</div>`;
}

function numberInput(name: string, label: string, value: string, help?: string): string {
  return `<div class="field">
  <label for="f-${name}">${esc(label)}</label>
  <input id="f-${name}" name="${name}" type="number" value="${esc(value)}"${
    help ? ` aria-describedby="f-${name}-help"` : ""
  }>
  ${help ? `<p class="help" id="f-${name}-help">${help}</p>` : ""}
</div>`;
}

function textarea(name: string, label: string, value: string, help?: string): string {
  return `<div class="field">
  <label for="f-${name}">${esc(label)}</label>
  <textarea id="f-${name}" name="${name}" rows="5"${
    help ? ` aria-describedby="f-${name}-help"` : ""
  }>${esc(value)}</textarea>
  ${help ? `<p class="help" id="f-${name}-help">${help}</p>` : ""}
</div>`;
}

function select(name: string, label: string, current: string, options: [string, string][]): string {
  return `<div class="field">
  <label for="f-${name}">${esc(label)}</label>
  <select id="f-${name}" name="${name}">
    ${options
      .map(
        ([v, l]) =>
          `<option value="${esc(v)}"${v === current ? " selected" : ""}>${esc(l)}</option>`,
      )
      .join("")}
  </select>
</div>`;
}

/**
 * A checkbox with its label beside it, not above it.
 *
 * And a hidden `off` before it, because an unchecked box posts nothing at all:
 * without the pair, "not required" is indistinguishable from "the form did not
 * mention it", and a save would silently keep the old value.
 */
function checkbox(name: string, label: string, checked: boolean, help?: string): string {
  return `<div class="field checkbox">
  <input type="hidden" name="${name}" value="off">
  <input id="f-${name}" name="${name}" type="checkbox" value="on"${checked ? " checked" : ""}${
    help ? ` aria-describedby="f-${name}-help"` : ""
  }>
  <label for="f-${name}">${esc(label)}</label>
  ${help ? `<p class="help" id="f-${name}-help">${esc(help)}</p>` : ""}
</div>`;
}
