/**
 * The properties panel, generated.
 *
 * ADR 0004 §"Consequence for § K": *"enum-driven and generated from the block's
 * declared attribute schema — the same schema the AI's `set_block_attrs`
 * validates against. One source, two consumers."* So this file contains no
 * per-block knowledge at all: the attribute list comes from the block type's
 * own `attrs` declaration, and the style controls from the tier-2 list in the
 * spec package.
 *
 * A hand-written panel per block would be the drift ADR 0004 exists to prevent,
 * one layer lower down — and it would go stale the first time somebody adds a
 * block type without opening this file.
 */
import type { Block } from "@forinda-cms/spec";
import type { BlockType } from "@forinda-cms/render";

import { esc } from "./view";

/**
 * Field names use `__`, never a dot.
 *
 * `attr.text` looks natural and is ambiguous: body parsers configurable with
 * `allowDots` turn it into a nested object, and the flat lookup then finds
 * nothing and writes an empty attribute set — a save that reports success and
 * changes nothing, which is the worst failure an editor can have. A separator
 * with no meaning to any parser cannot be reinterpreted.
 */

/**
 * Tier 2, as controls.
 *
 * Every entry is a closed set, because that is what makes it tier 2: ADR 0004's
 * rule is that a prop qualifies only if *"its value is a token reference or a
 * small closed enum. Never a free number, never a raw colour, never a px
 * value."* The moment one of these becomes a text box, tier 1 stops meaning
 * anything — restyling the brand no longer changes everything at once.
 *
 * `token:` values are resolved against the site's theme, so the options offered
 * are the ones this site actually has.
 */
const SCALE = ["", "none", "xs", "sm", "md", "lg", "xl"];

interface Control {
  readonly label: string;
  readonly options: readonly string[];
  /** Layout blocks only — `gap` on a heading means nothing (ADR 0004). */
  readonly layoutOnly?: boolean;
  readonly group: "Box" | "Surface" | "Type";
}

const STYLE_CONTROLS: Record<string, Control> = {
  padding: { label: "Padding", options: SCALE, group: "Box" },
  gap: { label: "Gap between children", options: SCALE, layoutOnly: true, group: "Box" },
  width: { label: "Width", options: ["", "full", "container", "narrow"], group: "Box" },
  align: { label: "Align", options: ["", "start", "center", "end", "stretch"], group: "Box" },
  justify: { label: "Justify", options: ["", "start", "center", "end", "between"], group: "Box" },
  background: { label: "Background", options: [], group: "Surface" },
  textColor: { label: "Text colour", options: [], group: "Surface" },
  radius: { label: "Corner radius", options: SCALE, group: "Surface" },
  border: { label: "Border", options: ["", "none", "hairline", "strong"], group: "Surface" },
  shadow: { label: "Shadow", options: ["", "none", "sm", "md"], group: "Surface" },
  textAlign: { label: "Text align", options: ["", "left", "center", "right"], group: "Type" },
  fontSize: { label: "Text size", options: [], group: "Type" },
  fontWeight: { label: "Weight", options: ["", "regular", "medium", "bold"], group: "Type" },
};

export interface InspectorOptions {
  readonly block: Block;
  readonly type: BlockType | undefined;
  readonly path: readonly number[];
  /** Theme tokens, so colour and size options are this site's, not a guess. */
  readonly colors: readonly string[];
  readonly typeScale: readonly string[];
  readonly action: string;
  readonly error?: string | undefined;
}

export function inspector(options: InspectorOptions): string {
  const { block, type, path, action, error } = options;

  if (!type) {
    return `<p class="error">This page uses a block called <code>${esc(block.type)}</code>, which this
      install does not have. Nothing here can edit it safely.</p>`;
  }

  const attrs = (block.attrs ?? {}) as Record<string, unknown>;

  // Attributes come from the block's own declaration. A block that gains an
  // attribute gains a field here, on the same deploy, without this file
  // changing.
  const attrFields = type.attrs
    .map((name) => {
      const value = attrs[name];
      // Objects and arrays are structure — a nav's links, a form's fields — and
      // a text box is the wrong shape for them. They stay in the spec until the
      // canvas has a real editor for each, rather than being flattened to JSON
      // in a box where one typo silently drops a section.
      if (value !== null && typeof value === "object") {
        return field(
          name,
          `<p class="help">Edited in the spec — ${esc(describeStructure(value))}.</p>`,
        );
      }
      return field(
        name,
        `<input name="attr__${esc(name)}" value="${esc(value == null ? "" : String(value))}">`,
      );
    })
    .join("\n");

  const variants = type.variants ?? [];
  const style = (block.style ?? {}) as Record<string, unknown>;

  const controls = Object.entries(STYLE_CONTROLS)
    .filter(([, control]) => !control.layoutOnly || type.layout === true)
    .map(([name, control]) => {
      // A fixed enum where ADR 0004 gives one, otherwise this site's own tokens
      // — so the colours offered are the theme's, not a guess at a palette.
      const choices = control.options.length > 0 ? control.options : tokenOptions(name, options);
      return select(`style__${name}`, control.label, choices, valueOf(style[name]));
    })
    .join("\n");

  return `${error ? `<p class="error">${esc(error)}</p>` : ""}
<form method="post" action="${esc(action)}" class="inspector">
  <input type="hidden" name="path" value="${esc(path.join("-"))}">
  <h3>${esc(type.name)}</h3>
  <p class="help">${esc(type.summary)}</p>
  ${attrFields}
  ${variants.length > 0 ? select("style__variant", "Variant", ["", ...variants], valueOf(style["variant"])) : ""}
  ${controls}
  <div class="actions"><button type="submit">Save</button></div>
</form>`;
}

/** Options for the props whose values are this site's tokens, not a fixed enum. */
function tokenOptions(name: string, options: InspectorOptions): readonly string[] {
  if (name === "background") return ["", "none", ...options.colors.map((c) => `token:color.${c}`)];
  if (name === "textColor") return ["", ...options.colors.map((c) => `token:color.${c}`)];
  if (name === "fontSize") return ["", ...options.typeScale];
  return [""];
}

function valueOf(value: unknown): string {
  // Responsive values (`{ md: "lg" }`) and per-axis padding are real, and a
  // single select cannot express them. Shown as-is and left alone rather than
  // silently flattened to their first value on save.
  return value === null || value === undefined || typeof value === "object" ? "" : String(value);
}

function describeStructure(value: unknown): string {
  return Array.isArray(value) ? `${value.length} item(s)` : "a structured value";
}

function field(name: string, control: string): string {
  return `<div class="field"><label>${esc(name)}</label>${control}</div>`;
}

function select(name: string, label: string, options: readonly string[], value: string): string {
  const opts = options
    .map(
      (option) =>
        `<option value="${esc(option)}"${option === value ? " selected" : ""}>${esc(option === "" ? "—" : option)}</option>`,
    )
    .join("");
  return `<div class="field"><label>${esc(label)}</label><select name="${esc(name)}">${opts}</select></div>`;
}
