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
import type { ContentType, Query } from "@forinda-cms/spec";

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
  /**
   * What the visitor asked for, and what the query found (ADR 0019).
   *
   * Only the blocks that exist to reflect the request read this — a filter
   * form showing what is currently applied, a pager showing where you are.
   */
  readonly request?: {
    readonly params: Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly path: string;
    readonly result?: { total: number; page: number; pages: number };
    /** The page's primary query, so a filter form can offer exactly what it reads. */
    readonly query?: Query;
  };
  /**
   * Rows the page's query matched under every filter *except* this block's own.
   *
   * What a facet counts. Given to every block for uniformity; only `facets`
   * reads it.
   */
  readonly rows?: readonly Record<string, unknown>[];
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
      name: "filters",
      summary: "A search form for the parameters this page's list actually reads.",
      attrs: ["for", "submit"],
      render: ({ className, attrs, contentType, request }) => {
        if (!contentType) return el("div", { class: className }, raw(""));

        // One input per parameter the query names, not one per filterable field.
        // A form offering `slug` when the list filters on `q` is a form whose
        // controls do nothing — which is worse than no form.
        const params = (request?.query?.where ?? []).flatMap((condition) => {
          const value = condition.value;
          if (typeof value !== "object" || value === null || !("param" in value)) return [];
          const field = contentType.fields.find((f) => f.name === condition.field);
          return field ? [{ param: value.param, field }] : [];
        });

        const fields = params.map(({ field, param }) => ({ ...field, name: param }));

        const current = (name: string) => {
          const value = request?.params[name];
          return typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? "") : "";
        };

        const inputs = fields.map((field) => {
          const label = el("label", { for: `f-${field.name}` }, raw(esc(field.label)));
          const control =
            field.type === "select" && "options" in field
              ? el(
                  "select",
                  { id: `f-${field.name}`, name: field.name },
                  fragment(
                    el("option", { value: "" }, raw(esc("Any"))),
                    ...field.options.map((option) =>
                      el(
                        "option",
                        {
                          value: option.value,
                          ...(current(field.name) === option.value ? { selected: "selected" } : {}),
                        },
                        raw(esc(option.label)),
                      ),
                    ),
                  ),
                )
              : el("input", {
                  id: `f-${field.name}`,
                  name: field.name,
                  type: inputTypeFor(field.type),
                  value: current(field.name),
                });

          return el("div", { class: "fx-field" }, fragment(label, control));
        });

        return el(
          "form",
          { class: `fx-filters ${className}`, method: "get", action: request?.path ?? "" },
          fragment(
            ...inputs,
            el("button", { type: "submit" }, raw(esc(String(attrs["submit"] ?? "Search")))),
          ),
        );
      },
    }),
    define({
      name: "facets",
      summary: "Filter options for one field, with how many rows each would match.",
      attrs: ["for", "field", "param", "title"],
      render: ({ className, attrs, request, rows }) => {
        const field = String(attrs["field"] ?? "");
        const param = String(attrs["param"] ?? field);
        if (!field || !rows) return raw("");

        // Counted over the rows the *other* filters left, with this facet's own
        // filter excluded — the standard behaviour, and the reason "4 stars ·
        // 251" stays useful after you tick it: the other options do not all
        // drop to zero.
        const counts = new Map<string, number>();
        for (const row of rows) {
          const value = row[field];
          if (value === undefined || value === null || value === "") continue;
          const key = String(value);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }

        const chosen = (() => {
          const value = request?.params[param];
          return typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
        })();

        const href = (value: string | undefined) => {
          const query = new URLSearchParams();
          for (const [key, raw_] of Object.entries(request?.params ?? {})) {
            // Paging resets: page 7 of the old filter is not page 7 of the new
            // one, and landing on an empty page reads as "no results".
            if (key === param || key === "page" || raw_ === undefined) continue;
            query.set(key, Array.isArray(raw_) ? (raw_[0] ?? "") : String(raw_));
          }
          if (value !== undefined) query.set(param, value);
          const search = query.toString();
          return search ? `${request?.path ?? ""}?${search}` : (request?.path ?? "");
        };

        const options = [...counts.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([value, count]) =>
            el(
              "li",
              value === chosen ? { "aria-current": "true" } : {},
              fragment(
                el("a", { href: href(value) }, raw(esc(value))),
                el("span", { class: "fx-facet-count" }, raw(esc(String(count)))),
              ),
            ),
          );

        return el(
          "div",
          { class: `fx-facets ${className}` },
          fragment(
            attrs["title"] ? el("h3", {}, raw(esc(String(attrs["title"])))) : raw(""),
            el(
              "ul",
              {},
              fragment(
                ...options,
                chosen !== undefined
                  ? el("li", {}, el("a", { href: href(undefined) }, raw(esc("Clear"))))
                  : raw(""),
              ),
            ),
          ),
        );
      },
    }),
    define({
      name: "results-count",
      summary: "How many rows the current filters matched.",
      attrs: ["one", "many"],
      render: ({ className, attrs, request }) => {
        const total = request?.result?.total ?? 0;
        const template = String(attrs[total === 1 ? "one" : "many"] ?? "{n} results");
        return el("p", { class: className }, raw(esc(template.replace("{n}", String(total)))));
      },
    }),
    define({
      name: "pager",
      summary: "Previous and next links for a paged list.",
      attrs: [],
      render: ({ className, request }) => {
        const result = request?.result;
        if (!result || result.pages <= 1) return raw("");

        // Every other parameter is preserved, or paging would silently drop the
        // visitor's filters on the second page.
        const href = (page: number) => {
          const query = new URLSearchParams();
          for (const [key, value] of Object.entries(request?.params ?? {})) {
            if (key === "page" || value === undefined) continue;
            query.set(key, Array.isArray(value) ? (value[0] ?? "") : String(value));
          }
          query.set("page", String(page));
          return `${request?.path ?? ""}?${query.toString()}`;
        };

        return el(
          "nav",
          { class: `fx-pager ${className}`, "aria-label": "Pagination" },
          fragment(
            result.page > 1
              ? el("a", { href: href(result.page - 1), rel: "prev" }, raw(esc("← Previous")))
              : raw(""),
            el("span", {}, raw(esc(`Page ${result.page} of ${result.pages}`))),
            result.page < result.pages
              ? el("a", { href: href(result.page + 1), rel: "next" }, raw(esc("Next →")))
              : raw(""),
          ),
        );
      },
    }),
    define({
      name: "gallery",
      summary: "Several pictures in a grid.",
      attrs: ["images", "alt"],
      layout: true,
      render: ({ className, attrs }) => {
        // A list of references, or one comma-separated string — the second is
        // what a text field in the inspector can hold today.
        const raw_ = attrs["images"];
        const sources = Array.isArray(raw_)
          ? raw_.map((value) => String(value))
          : String(raw_ ?? "")
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean);

        if (sources.length === 0) return raw("");

        const alt = String(attrs["alt"] ?? "");
        return el(
          "div",
          { class: `fx-gallery ${className}` },
          fragment(
            ...sources.map((src) => el("img", { src, alt, loading: "lazy", decoding: "async" })),
          ),
        );
      },
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

/**
 * Map a declared field type onto an input type the browser validates natively.
 *
 * Exported because the admin generates the same inputs from the same
 * declarations. Two copies of this mapping would drift, and the drift would show
 * up as a form that accepts what the schema rejects.
 */
export function inputTypeFor(fieldType: string): string {
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
