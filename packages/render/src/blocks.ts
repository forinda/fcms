/**
 * The core block registry.
 *
 * ADR 0002 seam 3: the registry exists from Phase 0 even though only core
 * populates it, **because the AI's tool surface and the plugin system both
 * enumerate it**. `list_available_blocks` is a read of this map; a plugin in
 * Phase 2 adds entries to it. Building the registry late would mean retrofitting
 * both.
 *
 * A block declares its `attrs` shape here rather than in `@forinda-cms/spec`,
 * which is why that package leaves `attrs` open: the document schema knows the
 * shape of *a block*, the registry knows the vocabulary of *each block type*.
 */
import type { ContentType } from "@forinda-cms/spec";

import { el, esc, fragment, raw, type Html } from "./html.js";
import type { Scope } from "./scope.js";

export interface BlockContext {
  readonly className: string;
  readonly attrs: Record<string, unknown>;
  readonly children: Html;
  readonly scope: Scope;
  /** Set when a block declares `for: <type>` — used to generate form inputs. */
  readonly contentType?: ContentType;
  /** True when the block author supplied children of their own. */
  readonly hasChildren: boolean;
}

export interface BlockType {
  readonly name: string;
  /** One line, shown in the admin and given to the AI. Keep it plain. */
  readonly summary: string;
  /** Attribute names this type reads. Enumerated for the AI and the panel. */
  readonly attrs: readonly string[];
  /** Variants this block declares — ADR 0004's pressure valve. */
  readonly variants?: readonly string[];
  /** True for blocks that lay out children (`gap` applies to these only). */
  readonly layout?: boolean;
  render(ctx: BlockContext): Html;
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

/** Only same-origin paths and http(s). Blocks must never emit `javascript:`. */
function safeHref(value: unknown): string | undefined {
  const href = str(value);
  if (!href) return undefined;
  if (
    /^(https?:)?\/\//i.test(href) ||
    href.startsWith("/") ||
    href.startsWith("#") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:")
  ) {
    return href;
  }
  return undefined;
}

const define = (b: BlockType): BlockType => b;

export const CORE_BLOCKS: Record<string, BlockType> = Object.fromEntries(
  [
    // ── Layout ──────────────────────────────────────────────────────────────
    define({
      name: "section",
      summary: "A full-width band of the page.",
      attrs: [],
      layout: true,
      render: ({ className, children }) =>
        el("section", { class: `fx-section ${className}` }, children),
    }),
    define({
      name: "stack",
      summary: "Children in a vertical column.",
      attrs: [],
      layout: true,
      render: ({ className, children }) => el("div", { class: `fx-stack ${className}` }, children),
    }),
    define({
      name: "row",
      summary: "Children in a horizontal row that wraps.",
      attrs: [],
      layout: true,
      render: ({ className, children }) => el("div", { class: `fx-row ${className}` }, children),
    }),
    define({
      name: "grid",
      summary: "Children in a responsive grid.",
      attrs: [],
      layout: true,
      render: ({ className, children }) => el("div", { class: `fx-grid ${className}` }, children),
    }),

    // ── Content ─────────────────────────────────────────────────────────────
    define({
      name: "heading",
      summary: "A headline.",
      attrs: ["text", "level"],
      render: ({ className, attrs }) => {
        const level = Math.min(Math.max(Number(attrs["level"]) || 2, 1), 4);
        return el(`h${level}`, { class: className }, str(attrs["text"]));
      },
    }),
    define({
      name: "text",
      summary: "A paragraph of plain text.",
      attrs: ["text"],
      render: ({ className, attrs }) => el("p", { class: className }, str(attrs["text"])),
    }),
    define({
      name: "richtext",
      summary: "Formatted text authored by the site owner.",
      attrs: ["html"],
      // The single audited opt-out from auto-escaping (html.ts). Safe only while
      // richtext is owner-authored through the admin. Phase 0b must sanitise
      // here the moment a visitor-submitted field can reach it.
      render: ({ className, attrs }) => el("div", { class: className }, raw(str(attrs["html"]))),
    }),
    define({
      name: "image",
      summary: "A picture.",
      attrs: ["src", "alt", "width", "height"],
      render: ({ className, attrs }) =>
        el("img", {
          class: className,
          src: str(attrs["src"]),
          // Always present, even when empty: an absent `alt` is read aloud as the
          // filename, an empty one marks the image decorative. Accessibility
          // basics are not something to simplify away.
          alt: str(attrs["alt"]),
          width: typeof attrs["width"] === "number" ? attrs["width"] : undefined,
          height: typeof attrs["height"] === "number" ? attrs["height"] : undefined,
          loading: "lazy",
          decoding: "async",
        }),
    }),
    define({
      name: "button",
      summary: "A link styled as a button.",
      attrs: ["label", "to"],
      variants: ["primary", "secondary", "outline"],
      render: ({ className, attrs }) => {
        const href = safeHref(attrs["to"]);
        const label = str(attrs["label"], "Continue");
        return href
          ? el("a", { class: `fx-button ${className}`, href }, label)
          : el("button", { class: `fx-button ${className}`, type: "button" }, label);
      },
    }),
    define({
      name: "card",
      summary: "A titled block of content, usually one row of a list.",
      attrs: ["heading", "body", "image", "to"],
      variants: ["plain", "elevated"],
      render: ({ className, attrs, children }) => {
        const href = safeHref(attrs["to"]);
        const inner = fragment(
          str(attrs["image"])
            ? el("img", { src: str(attrs["image"]), alt: "", loading: "lazy" })
            : null,
          str(attrs["heading"]) ? el("h3", {}, str(attrs["heading"])) : null,
          str(attrs["body"]) ? el("p", {}, str(attrs["body"])) : null,
          children,
        );
        return el(
          "article",
          { class: `fx-card ${className}` },
          href ? el("a", { href }, inner) : inner,
        );
      },
    }),
    define({
      name: "list",
      summary: "Renders one child template per row of a query.",
      attrs: [],
      layout: true,
      render: ({ className, children }) => el("div", { class: `fx-grid ${className}` }, children),
    }),
    define({
      name: "divider",
      summary: "A horizontal rule.",
      attrs: [],
      render: ({ className }) => el("hr", { class: className }),
    }),
    define({
      name: "spacer",
      summary: "Vertical space.",
      attrs: [],
      render: ({ className }) => el("div", { class: className, "aria-hidden": "true" }),
    }),

    // ── Structure ───────────────────────────────────────────────────────────
    define({
      name: "nav",
      summary: "Site navigation.",
      attrs: ["links"],
      render: ({ className, attrs }) => {
        const links = Array.isArray(attrs["links"]) ? attrs["links"] : [];
        return el(
          "nav",
          { class: `fx-nav ${className}`, "aria-label": "Main" },
          el(
            "ul",
            {},
            ...links.map((raw_) => {
              const link = raw_ as Record<string, unknown>;
              const href = safeHref(link["to"]);
              return el(
                "li",
                {},
                href ? el("a", { href }, str(link["label"])) : str(link["label"]),
              );
            }),
          ),
        );
      },
    }),
    define({
      name: "footer",
      summary: "Page footer.",
      attrs: ["text"],
      layout: true,
      render: ({ className, attrs, children }) =>
        el(
          "footer",
          { class: className },
          str(attrs["text"]) ? el("p", {}, str(attrs["text"])) : null,
          children,
        ),
    }),

    // ── Forms ───────────────────────────────────────────────────────────────
    define({
      name: "form",
      summary: "A form over a content type. Renders fields; does not submit in the spike.",
      attrs: ["for", "submitLabel"],
      /**
       * With no children, the inputs are generated from the content type's
       * declared fields (ADR 0014, decision 5). Children still win when present,
       * for ordering or a subset.
       *
       * This removes a place where the type and the form drift apart — the
       * salon fixture had to repeat every field by hand, and nothing kept the
       * two in step.
       */
      render: ({ className, attrs, children, hasChildren, contentType }) => {
        const generated =
          !hasChildren && contentType
            ? fragment(
                ...contentType.fields
                  .filter((f) => f.type !== "state" && f.name !== "slug")
                  .map((f) =>
                    renderField(
                      f.name,
                      f.label,
                      inputTypeFor(f.type),
                      f.type === "richtext",
                      "required" in f ? f.required === true : false,
                    ),
                  ),
              )
            : null;
        return el(
          "form",
          { class: `fx-form ${className}`, method: "post", "data-for": str(attrs["for"]) },
          hasChildren ? children : generated,
          el("button", { type: "submit" }, str(attrs["submitLabel"], "Submit")),
        );
      },
    }),
    define({
      name: "field",
      summary: "One input inside a form.",
      attrs: ["name", "label", "type", "required"],
      render: ({ className, attrs }) => {
        const name = str(attrs["name"]);
        const type = str(attrs["type"], "text");
        return renderField(
          name,
          str(attrs["label"], name),
          type,
          type === "richtext",
          attrs["required"] === true,
          className,
        );
      },
    }),
  ].map((b) => [b.name, b]),
);

/** Map a declared field type onto an input type the browser validates natively. */
function inputTypeFor(fieldType: string): string {
  switch (fieldType) {
    case "email":
      return "email";
    case "phone":
      return "tel";
    case "url":
      return "url";
    case "number":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime-local";
    case "boolean":
      return "checkbox";
    default:
      return "text";
  }
}

function renderField(
  name: string,
  label: string,
  type: string,
  multiline: boolean,
  required: boolean,
  className = "",
): Html {
  const id = `f-${name}`;
  return el(
    "div",
    { class: `fx-field ${className}`.trim() },
    // Always a real `<label for>` rather than a placeholder: a placeholder is not
    // a label, and screen readers do not treat it as one. Accessibility basics
    // are not something to simplify away.
    el("label", { for: id }, label),
    multiline ? el("textarea", { id, name, required }) : el("input", { id, name, type, required }),
  );
}

/**
 * A block type the registry does not know.
 *
 * Rendered as a visible placeholder rather than dropped silently — ADR 0001's
 * rule is that the system names its ceiling honestly and never approximates. An
 * unknown block on a page is information, not something to hide.
 */
export function unknownBlock(type: string): Html {
  return raw(
    `<div class="fx-unknown" role="note">Unknown block type <code>${esc(type)}</code>` +
      ` — it may need a plugin, or the name may be a typo.</div>`,
  );
}
