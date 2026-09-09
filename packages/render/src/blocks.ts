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
import type { ContentType, Query, SiteSpec } from "@forinda-cms/spec";

import { el, esc, fragment, raw, type Html } from "./html.js";
import { pointOf } from "./places.js";
import type { Scope } from "./scope.js";
import type { EntrySource } from "./entries.js";

export interface BlockContext {
  readonly className: string;
  readonly attrs: Record<string, unknown>;
  readonly children: Html;
  readonly scope: Scope;
  /** Set when a block declares `for: <type>` — used to generate form inputs. */
  readonly contentType?: ContentType;
  /**
   * The whole spec and the rows behind it.
   *
   * A facet counting a `reference` holds `ref:city/nairobi` and has to show
   * "Nairobi", which is on the row that reference points at — so the block
   * needs to reach past its own rows. Optional, because most blocks do not.
   */
  readonly spec?: SiteSpec;
  readonly source?: EntrySource;
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
  /**
   * True for blocks that emit a `<form>` of their own.
   *
   * A flow step that chooses wraps its blocks in a form to post the choice, and
   * a form inside a form is not markup a browser keeps — it closes the outer
   * one early, and whichever of the two the author needed stops working. The
   * flow reads this rather than guessing by name.
   */
  readonly ownsForm?: boolean;
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
    /**
     * A toggle, without a line of JavaScript.
     *
     * A spec has no `<script>`, no checkbox and, until now, no element that
     * opens — so a mobile menu was inexpressible: a phone header spent ~190px
     * on a wordmark, two buttons and a nav wrapped onto two lines. The
     * approximations were a `:target` link (no `aria-expanded`, no Escape, and
     * a history entry per open) or a scrolling row of links.
     *
     * `<details>` is the native answer and it is better than either: keyboard
     * operable, its open state announced, Escape closes it, and it needs
     * nothing from us. Which is the argument for the block existing rather than
     * for a menu block: this is a disclosure, and a menu is one thing to put in
     * it.
     */
    define({
      name: "disclosure",
      summary: "A label that opens to reveal what is inside it.",
      attrs: ["label", "open"],
      layout: true,
      render: ({ className, attrs, children }) =>
        el(
          "details",
          {
            class: `fx-disclosure ${className}`,
            // Open on the page it belongs to — an FAQ answer somebody linked
            // to, a filter rail that starts expanded on a wide screen.
            ...(attrs["open"] === true ? { open: "" } : {}),
          },
          el("summary", {}, str(attrs["label"], "More")),
          children,
        ),
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
      attrs: ["heading", "body", "meta", "image", "to"],
      variants: ["plain", "elevated", "price"],
      render: ({ className, attrs, children }) => {
        const href = safeHref(attrs["to"]);
        const inner = fragment(
          str(attrs["image"])
            ? el("img", { src: str(attrs["image"]), alt: "", loading: "lazy" })
            : null,
          str(attrs["heading"]) ? el("h3", {}, str(attrs["heading"])) : null,
          str(attrs["body"]) ? el("p", {}, str(attrs["body"])) : null,
          // The line a listing card always ends up needing: a price, a
          // distance, a rating. Without it an author reaches for a second
          // `text` block and loses the card's own layout.
          str(attrs["meta"]) ? el("p", { class: "fx-card-meta" }, str(attrs["meta"])) : null,
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
      ownsForm: true,
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
          return field ? [{ ...value, field }] : [];
        });

        // The clause's own words where it has them. A field's label answers
        // "what is this column"; a filter's answers "what am I asking you", so
        // a help centre searched by `title` had a search box labelled "Title".
        const fields = params.map(({ field, param, label, placeholder }) => ({
          ...field,
          name: param,
          ...(label ? { label } : {}),
          ...(placeholder ? { placeholder } : {}),
        }));

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
                  ...("placeholder" in field && field.placeholder
                    ? { placeholder: field.placeholder }
                    : {}),
                });

          return el("div", { class: "fx-field" }, fragment(label, control));
        });

        // A stay type is searched by the two dates it declares, and the block
        // names the inputs itself (ADR 0025 §6): an author writing
        // `<input name="check-in">` by hand and getting the name subtly wrong
        // is a form whose controls do nothing.
        const range =
          contentType.derived?.kind === "stay"
            ? [contentType.derived.range.from, contentType.derived.range.to].map((param, i) =>
                el(
                  "div",
                  { class: "fx-field" },
                  fragment(
                    el(
                      "label",
                      { for: `f-${param}` },
                      raw(esc(i === 0 ? "Check in" : "Check out")),
                    ),
                    el("input", {
                      id: `f-${param}`,
                      name: param,
                      type: "date",
                      value: current(param),
                    }),
                  ),
                ),
              )
            : [];

        return el(
          "form",
          { class: `fx-filters ${className}`, method: "get", action: request?.path ?? "" },
          fragment(
            ...range,
            ...inputs,
            el("button", { type: "submit" }, raw(esc(String(attrs["submit"] ?? "Search")))),
          ),
        );
      },
    }),
    define({
      name: "facets",
      summary: "Filter options for one field, with how many rows each would match.",
      attrs: ["for", "field", "param", "title", "order"],
      render: ({ className, attrs, request, rows, contentType, spec, source }) => {
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

        // What a person calls this value. A `select` declares its own labels, a
        // `reference` has them on the row it points at, and a `boolean` has two
        // that no spec should have to write out. Showing `ref:city/nairobi` in
        // a filter rail is showing somebody the storage format.
        const declared = contentType?.fields.find((f) => f.name === field);
        const labelOf = (value: string): string => {
          if (declared?.type === "select") {
            return declared.options.find((o) => o.value === value)?.label ?? value;
          }
          if (declared?.type === "boolean") return value === "true" ? "Yes" : "No";
          if (declared?.type === "reference" && source && spec) {
            const target = spec.content.find((t) => t.key === declared.to);
            const slug = value.startsWith("ref:") ? value.slice(value.indexOf("/") + 1) : value;
            const row = source
              .all(declared.to)
              .find((r) => String(r["slug"] ?? r["id"] ?? "") === slug);
            const title = row?.[target?.titleField ?? "name"];
            return typeof title === "string" && title !== "" ? title : slug;
          }
          return value;
        };

        // By count is right for "which of these is popular" and wrong for a
        // star rating, which reads 4, 3, 1, 2, 5 when the answer wanted is
        // 1, 2, 3, 4, 5.
        const order = String(attrs["order"] ?? "count");
        const collate = (a: [string, number], b: [string, number]): number => {
          if (order === "value") return a[0].localeCompare(b[0], undefined, { numeric: true });
          if (order === "label") return labelOf(a[0]).localeCompare(labelOf(b[0]));
          return b[1] - a[1] || a[0].localeCompare(b[0]);
        };

        const options = [...counts.entries()]
          .sort(collate)
          .map(([value, count]) =>
            el(
              "li",
              value === chosen ? { "aria-current": "true" } : {},
              fragment(
                el("a", { href: href(value) }, raw(esc(labelOf(value)))),
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
        // `{{ results.total }}` resolves before this block sees the attribute —
        // it is in scope like anything else. `{n}` stays for the specs written
        // before that was true.
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
      name: "account",
      ownsForm: true,
      summary: "Sign in, register, or sign out — for the site's own visitors.",
      attrs: ["mode", "submit"],
      render: ({ className, attrs, request }) => {
        const mode = String(attrs["mode"] ?? "signin");
        const here = request?.path ?? "/";

        if (mode === "signout") {
          return el(
            "form",
            { class: `fx-account ${className}`, method: "post", action: "/account/signout" },
            fragment(
              el("input", { type: "hidden", name: "from", value: here }),
              el("button", { type: "submit" }, raw(esc(String(attrs["submit"] ?? "Sign out")))),
            ),
          );
        }

        const registering = mode === "register";
        const error = (() => {
          const value = request?.params["account_error"];
          return typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
        })();

        return el(
          "form",
          {
            class: `fx-account ${className}`,
            method: "post",
            action: registering ? "/account/register" : "/account/signin",
          },
          fragment(
            error ? el("p", { class: "fx-error", role: "alert" }, raw(esc(error))) : raw(""),
            el("input", { type: "hidden", name: "from", value: here }),
            registering
              ? el(
                  "div",
                  { class: "fx-field" },
                  fragment(
                    el("label", { for: "account-name" }, raw(esc("Your name"))),
                    el("input", { id: "account-name", name: "name", autocomplete: "name" }),
                  ),
                )
              : raw(""),
            el(
              "div",
              { class: "fx-field" },
              fragment(
                el("label", { for: "account-email" }, raw(esc("Email"))),
                el("input", {
                  id: "account-email",
                  name: "email",
                  type: "email",
                  required: "required",
                  autocomplete: "email",
                }),
              ),
            ),
            el(
              "div",
              { class: "fx-field" },
              fragment(
                el("label", { for: "account-password" }, raw(esc("Password"))),
                el("input", {
                  id: "account-password",
                  name: "password",
                  type: "password",
                  required: "required",
                  // The browser offers to make one on a register form and to
                  // fill it on a sign-in form; the wrong hint gets both wrong.
                  autocomplete: registering ? "new-password" : "current-password",
                }),
              ),
            ),
            el(
              "button",
              { type: "submit" },
              raw(esc(String(attrs["submit"] ?? (registering ? "Create account" : "Sign in")))),
            ),
          ),
        );
      },
    }),
    define({
      name: "save-button",
      summary: "Lets a signed-in visitor keep this entry.",
      attrs: ["for", "label", "saved"],
      render: ({ className, attrs, scope, request }) => {
        // The row being rendered — this block belongs inside a list's `item`,
        // where `item.id` is the entry it is about.
        const item = (scope as { item?: Record<string, unknown> }).item;
        const id = item?.["id"];
        if (id === undefined) return raw("");

        return el(
          "form",
          { class: `fx-save ${className}`, method: "post", action: "/account/save" },
          fragment(
            el("input", { type: "hidden", name: "entry", value: String(id) }),
            el("input", { type: "hidden", name: "type", value: String(attrs["for"] ?? "") }),
            el("input", { type: "hidden", name: "from", value: request?.path ?? "/" }),
            el(
              "button",
              { type: "submit", "aria-label": String(attrs["label"] ?? "Keep this") },
              raw(esc(String(attrs["label"] ?? "♥"))),
            ),
          ),
        );
      },
    }),
    define({
      name: "map",
      summary: "Where this is, on a map.",
      attrs: ["at", "zoom", "title"],
      render: ({ className, attrs, scope }) => {
        // The coordinate comes from the row, not from the author typing numbers
        // into a block: `at` names the field, the same way `for` names a type.
        const field = str(attrs["at"], "location");
        const entry = (scope["entry"] ?? scope["item"]) as Record<string, unknown> | undefined;
        const point = pointOf(entry?.[field]);
        if (!point) return raw("");

        const zoom = Math.min(19, Math.max(1, Number(attrs["zoom"]) || 15));
        // Roughly a few streets at zoom 15, and the box is what OSM's embed
        // takes. Wider zoom, wider box.
        const span = 0.02 * 2 ** (15 - zoom);
        const box = [
          point.lng - span,
          point.lat - span / 2,
          point.lng + span,
          point.lat + span / 2,
        ].join(",");
        const at = `${point.lat},${point.lng}`;

        return el(
          "div",
          { class: `fx-map ${className}` },
          fragment(
            el("iframe", {
              // OpenStreetMap's own embed: no key, no account, no script, and
              // nothing that stops working when a free tier ends (ADR 0026 §3).
              src: `https://www.openstreetmap.org/export/embed.html?bbox=${box}&marker=${at}`,
              title: str(attrs["title"], "Map"),
              loading: "lazy",
              // The frame is a third party's: it gets no more than the page it
              // is on, and cannot navigate the page that embedded it.
              referrerpolicy: "no-referrer",
              sandbox: "allow-scripts allow-popups",
            }),
            el(
              "a",
              {
                class: "fx-map-link",
                href: `https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lng}#map=${zoom}/${point.lat}/${point.lng}`,
                target: "_blank",
                rel: "noopener noreferrer",
              },
              "Open in a map",
            ),
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
      attrs: ["links", "label"],
      render: ({ className, attrs }) => {
        const links = Array.isArray(attrs["links"]) ? attrs["links"] : [];
        return el(
          "nav",
          // Named, because a footer of five link columns and a header nav are
          // six landmarks, and announcing all of them "Main navigation" is
          // worse than announcing none of them.
          { class: `fx-nav ${className}`, "aria-label": str(attrs["label"], "Main") },
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
      ownsForm: true,
      summary: "A form over a content type. Submits to the site when the type allows it.",
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
      render: ({ className, attrs, children, hasChildren, contentType, request }) => {
        const generated =
          !hasChildren && contentType
            ? fragment(
                ...contentType.fields
                  .filter((f) => f.type !== "state" && f.name !== "slug")
                  // Computed on read and never written, so an input for one is
                  // an input the schema refuses — the form would collect a
                  // number and be told it is invalid.
                  .filter((f) => f.type !== "aggregate" && f.type !== "computed")
                  .map((f) =>
                    renderField(
                      f.name,
                      f.label,
                      inputTypeFor(f.type),
                      f.type === "richtext",
                      "required" in f ? f.required === true : false,
                      "",
                      "options" in f ? f.options : [],
                      "help" in f && typeof f.help === "string" ? f.help : "",
                    ),
                  ),
              )
            : null;
        // Posts to the submission route when the *type* allows it (ADR 0020
        // §3). A form over a type that accepts nothing still renders — it is
        // how an author builds one before opening it — and the route refuses.
        const target = str(attrs["for"]);

        return el(
          "form",
          {
            class: `fx-form ${className}`,
            method: "post",
            action: target ? `/submit/${target}` : "",
            "data-for": target,
          },
          fragment(
            hasChildren ? children : generated,
            el("input", { type: "hidden", name: "from", value: request?.path ?? "/" }),
            el("button", { type: "submit" }, str(attrs["submitLabel"], "Submit")),
          ),
        );
      },
    }),
    define({
      name: "field",
      summary: "One input inside a form.",
      attrs: ["name", "label", "type", "required", "placeholder"],
      render: ({ className, attrs, contentType }) => {
        const name = str(attrs["name"]);
        // The declaration wins over the attribute where there is one: a field
        // named here is a field the type already describes, and repeating its
        // type in the page is how the two come to disagree.
        const declared = contentType?.fields.find((f) => f.name === name);
        const type = declared ? inputTypeFor(declared.type) : str(attrs["type"], "text");

        return renderField(
          name,
          str(attrs["label"], declared?.label ?? name),
          type,
          declared ? declared.type === "richtext" : type === "richtext",
          declared && "required" in declared
            ? declared.required === true
            : attrs["required"] === true,
          className,
          declared && "options" in declared ? declared.options : [],
          str(attrs["placeholder"]),
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
  /**
   * A `select` field's own options.
   *
   * `filters` has rendered these since it existed; a `form` rendered the same
   * field as a free-text box, which made a closed set of choices into a place
   * to type anything — and then refused what was typed.
   */
  options: readonly { value: string; label: string }[] = [],
  /**
   * Hint text, *in addition to* the label and never instead of it: a
   * placeholder is not a label and screen readers do not treat it as one.
   */
  placeholder = "",
): Html {
  const id = `f-${name}`;
  const hint = placeholder === "" ? {} : { placeholder };

  const control =
    options.length > 0
      ? el(
          "select",
          { id, name, required },
          // An empty first option, so a select that is not required can be left
          // alone and one that is required does not answer with its first
          // option by accident.
          el("option", { value: "" }, required ? "Choose one" : "Any"),
          ...options.map((option) => el("option", { value: option.value }, option.label)),
        )
      : multiline
        ? el("textarea", { id, name, required, ...hint })
        : el("input", { id, name, type, required, ...hint });

  return el(
    "div",
    { class: `fx-field ${className}`.trim() },
    // Always a real `<label for>`. Accessibility basics are not something to
    // simplify away.
    el("label", { for: id }, label),
    control,
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
