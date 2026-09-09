/**
 * The deterministic runtime: a spec plus rows in, HTML out.
 *
 * No model runs here. Doc 02's "Compiled AI" property is what makes the pricing
 * in ADR 0011 possible — the LLM runs at *edit* time, so a page view costs
 * nothing and a customer's site keeps serving whether or not anyone is paying
 * for inference (doc 13).
 */
import {
  collectionType,
  type Block,
  type Page,
  type Query,
  type SiteSpec,
} from "@forinda-cms/spec";

import { CORE_BLOCKS, unknownBlock, type BlockType } from "./blocks.js";
import { blockCss, siteCss } from "./css.js";
import {
  matches,
  runQueryExcluding,
  runQueryPage,
  withDerived,
  type Entry,
  type EntrySource,
  type QueryResult,
} from "./entries.js";
import { el, fragment, raw, render as toString, type Html } from "./html.js";
import { analytics } from "./agents.js";
import { buildJsonLd, head, pageSeo } from "./seo.js";
import { DEFAULT_LOCALE, resolveAttrs, type FormatLocale, type Scope } from "./scope.js";

export interface RenderOptions {
  readonly spec: SiteSpec;
  readonly source: EntrySource;
  readonly registry?: Record<string, BlockType>;
  readonly canonicalBase?: string;
  /** Defaults to Kenya-first (doc 14). Moves into the spec in Phase 0b. */
  readonly locale?: FormatLocale;
  /** Injected so derived types (ADR 0014) render deterministically in tests. */
  readonly now?: Date;
  /**
   * What the visitor asked for (ADR 0019).
   *
   * Queries read it through `{ param }` conditions; the `filters`, `pager` and
   * `results-count` blocks read it to show what is applied and where you are.
   */
  readonly params?: Readonly<Record<string, string | readonly string[] | undefined>>;
  /** The path being rendered, so a filter form and a pager can post back to it. */
  readonly path?: string;
  /**
   * The signed-in visitor, when there is one (ADR 0027).
   *
   * Supplied by the server from the session cookie. A `mine: true` query is
   * answered against this and nothing else — there is no parameter that can
   * name whose rows to return.
   */
  readonly viewer?: string | null;
  /**
   * What this visitor has already chosen in the page's flows (ADR 0028).
   *
   * Supplied by the server from the journey's state row — the renderer has no
   * database, and what has been answered is not something a request may assert.
   */
  readonly flow?: Readonly<Record<string, Record<string, unknown>>>;
  /**
   * Render every step of every flow at once.
   *
   * For an authoring preview (`fcms dev`), which has no database and therefore
   * no journey: an author writing a four-step booking needs to see all four,
   * and the alternative is a preview that shows step one forever.
   */
  readonly previewFlows?: boolean;
}

/**
 * A stable class per block position.
 *
 * Position-derived rather than random so that re-rendering the same spec
 * produces byte-identical output — which is what lets `fcms dev` diff a page and
 * what makes the eventual static-render path cacheable.
 */
/** The first query in the tree, depth-first — the one the page is *about*. */
function firstQuery(blocks: readonly Block[]): Query | undefined {
  for (const block of blocks) {
    if (block.data && block.item) return block.data;
    const nested = firstQuery(block.children ?? []);
    if (nested) return nested;
  }
  return undefined;
}

function className(path: readonly number[]): string {
  return `b${path.join("-")}`;
}

interface Walk {
  readonly css: string[];
  /** The page's key, so a flow's steps know where to post. */
  readonly pageKey: string;
  /** Authoring preview: every step at once (see `RenderOptions`). */
  readonly previewFlows?: boolean;
  /**
   * Set while rendering a step that chooses (ADR 0028 §2).
   *
   * The rows of *this* type become buttons carrying what they are, so a card
   * in a `selects` step is a choice rather than a decoration. Any other query
   * on the same step renders normally.
   */
  readonly selecting?: string;
  /** Who is asking. Threaded to every query on the page. */
  readonly viewer?: string | null;
  /**
   * The row this page is *for*, on a collection page.
   *
   * Threaded to every query so a `{ entry: … }` condition can name it — the
   * rooms of this property, the reviews of this property. Absent on an ordinary
   * page, where such a condition matches nothing rather than everything.
   */
  readonly entry?: Entry;
  readonly params: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly path: string;
  /**
   * The page's main query, run once before anything renders.
   *
   * A count or a filter form sits *above* the list it describes, so resolving
   * this while walking the tree meant those blocks rendered before the query
   * existed and reported nothing. One page, one primary query — which is also
   * what a listing page means by "451 properties found".
   */
  primary?: { query: Query; result: QueryResult };
  readonly registry: Record<string, BlockType>;
  readonly source: EntrySource;
  readonly locale: FormatLocale;
  readonly spec: SiteSpec;
}

function renderBlock(block: Block, scope: Scope, path: readonly number[], walk: Walk): Html {
  // `when` gates the whole subtree. Evaluated against the current scope, so a
  // condition inside an `item` sees that row.
  if (block.when && !matches(scope as Entry, block.when)) return raw("");

  // A component is placed, not rendered: its blocks render here as if they had
  // been written here, keeping the current scope so an instance inside an
  // `item` still sees that row. No recursion limit is needed — the schema
  // forbids a component containing a component (ADR 0022).
  if (block.type === "component") {
    const use = (block.attrs ?? {})["use"];
    const component = walk.spec.components.find((c) => c.key === use);
    if (!component) return unknownBlock(`component "${String(use)}"`);
    return fragment(
      ...component.blocks.map((child, i) => renderBlock(child, scope, [...path, i], walk)),
    );
  }

  const cls = className(path);
  const css = blockCss(cls, block.style, block.css);
  if (css) walk.css.push(css);

  // A `data` block renders `item` once per row instead of its children. The
  // schema guarantees the two travel together, so neither branch is partial.
  let children: Html;
  if (block.data && block.item) {
    // Reuse the pre-computed result where this is the page's primary query, so
    // it runs once rather than once per render pass.
    const result =
      walk.primary && walk.primary.query === block.data
        ? walk.primary.result
        : runQueryPage(walk.source, block.data, walk.params, walk.viewer, walk.entry);
    const rows = result.rows;
    children = fragment(
      ...rows.map((row, i) => {
        const rendered = fragment(
          ...block.item!.map((child, j) =>
            renderBlock(child, { ...scope, item: row }, [...path, i, j], walk),
          ),
        );

        // In a choosing step, the row is the choice: a submit button carrying
        // what was picked, so the journey advances without JavaScript.
        return walk.selecting === block.data!.from
          ? el(
              "button",
              {
                type: "submit",
                name: "choice",
                value: String(row["slug"] ?? row["id"] ?? ""),
                class: "fx-choice",
              },
              rendered,
            )
          : rendered;
      }),
    );
  } else {
    children = fragment(
      ...(block.children ?? []).map((child, i) => renderBlock(child, scope, [...path, i], walk)),
    );
  }

  const type = walk.registry[block.type];
  if (!type) return unknownBlock(block.type);

  const attrs = resolveAttrs(block.attrs, scope, walk.locale);
  const forType =
    typeof attrs["for"] === "string"
      ? walk.spec.content.find((t) => t.key === attrs["for"])
      : undefined;

  // A facet counts across the query with its own filter lifted, which only it
  // needs and only it can name.
  const facetRows =
    type.name === "facets" && walk.primary
      ? runQueryExcluding(
          walk.source,
          walk.primary.query,
          walk.params,
          String(attrs["param"] ?? attrs["field"] ?? ""),
          walk.entry,
        )
      : undefined;

  // `style.variant` has validated since the schema had a style, the admin has
  // offered a Variant select from `block.variants`, and nothing was ever
  // emitted for it — the declared pressure valve was inert. A block declares
  // its variants and gets the class; one it did not declare is ignored rather
  // than styled by accident.
  const variant = block.style?.variant;
  const classes =
    variant && type.variants?.includes(variant) ? `${cls} fx-variant-${variant}` : cls;

  const rendered = type.render({
    className: classes,
    attrs,
    ...(facetRows ? { rows: facetRows } : {}),
    request: {
      params: walk.params,
      path: walk.path,
      ...(walk.primary ? { result: walk.primary.result, query: walk.primary.query } : {}),
    },
    children,
    scope,
    hasChildren: (block.children?.length ?? 0) > 0,
    ...(forType ? { contentType: forType } : {}),
    // For a facet naming a reference: the label is on the row it points at.
    spec: walk.spec,
    source: walk.source,
  });

  // An anchor, beside the block rather than on it.
  //
  // A block owns its own root element and some render several, or none — so
  // putting the id *on* it would mean every block type in the registry
  // agreeing to carry one, and a plugin's block silently not. An empty span
  // costs nothing, moves nothing, and `#book` resolves.
  return block.id ? fragment(el("span", { id: block.id, class: "fx-anchor" }), rendered) : rendered;
}

/**
 * Which step a visitor is on (ADR 0028 §2).
 *
 * The first step whose requirements are answered and whose own answer is
 * missing. `requires` rather than order, because `when` can skip a step — so
 * "the next one" is not "the one after this".
 */
export function currentStep(
  flow: NonNullable<Page["flows"]>[number],
  answers: Readonly<Record<string, unknown>>,
  scope: Scope = {},
): { step: NonNullable<Page["flows"]>[number]["steps"][number]; index: number } | null {
  for (const [index, step] of flow.steps.entries()) {
    if (step.when && !matches(scope as Entry, step.when)) continue;
    if ((step.requires ?? []).some((need) => answers[need] === undefined)) continue;
    if (answers[step.key] === undefined) return { step, index };
  }
  return null;
}

/**
 * A flow, rendered one step at a time.
 *
 * ADR 0007 accepted a journey that rendered without completing — *"a flow that
 * renders but cannot be completed is a successful spike"*. It completes now:
 * the state is a row on the server, this shows the step it names, and the
 * answered steps become a summary, because a journey that cannot show what you
 * already picked makes people start again.
 */
function renderFlow(
  flow: NonNullable<Page["flows"]>[number],
  scope: Scope,
  path: readonly number[],
  walk: Walk,
): Html {
  const answers = (scope["flow"] ?? {}) as Record<string, unknown>;

  // An authoring preview shows the whole journey, marked, because it has no
  // state to be part-way through.
  if (walk.previewFlows) {
    return el(
      "div",
      { class: "fx-flow", "data-flow": flow.key, "data-preview": "all" },
      el(
        "ol",
        { class: "fx-flow-steps" },
        ...flow.steps.map((step, i) =>
          el("li", { "aria-current": i === 0 ? "step" : undefined }, step.label ?? step.key),
        ),
      ),
      ...flow.steps.map((step, i) =>
        el(
          "section",
          { class: "fx-flow-step", "data-step": step.key },
          ...step.blocks.map((b, j) => renderBlock(b, scope, [...path, i, j], walk)),
        ),
      ),
    );
  }

  const here = currentStep(flow, answers, scope);
  const action = `/flow/${walk.pageKey}/${flow.key}`;

  const trail = el(
    "ol",
    { class: "fx-flow-steps" },
    ...flow.steps.map((step, i) =>
      el(
        "li",
        {
          class: answers[step.key] !== undefined ? "done" : undefined,
          "aria-current": i === here?.index ? "step" : undefined,
        },
        step.label ?? step.key,
      ),
    ),
  );

  // What has been chosen so far, with a way back to change it.
  const chosen = flow.steps
    .filter((step) => answers[step.key] !== undefined)
    .map((step) =>
      el(
        "div",
        { class: "fx-flow-chosen" },
        el("span", {}, `${step.label ?? step.key}: ${describeChoice(answers[step.key])}`),
        el(
          "form",
          { method: "post", action: `${action}/${step.key}/undo` },
          el("button", { type: "submit", class: "fx-flow-change" }, "Change"),
        ),
      ),
    );

  if (!here) {
    return el(
      "div",
      { class: "fx-flow", "data-flow": flow.key },
      trail,
      ...chosen,
      el("p", { class: "fx-flow-done" }, "Everything is chosen."),
    );
  }

  // A copy rather than a mutation: `css` is the same array, so styles still
  // collect, and the flag lasts exactly as long as this step's subtree.
  //
  // The step's own query is its primary one, so `results-count` and `pager`
  // inside a step can say what the step found. Without it a step reported
  // " rooms free for those nights" — the sentence with the number missing.
  const stepQuery = firstQuery(here.step.blocks);
  const stepWalk: Walk = {
    ...walk,
    ...(here.step.selects ? { selecting: here.step.selects.from } : {}),
    ...(stepQuery
      ? {
          primary: {
            query: stepQuery,
            result: runQueryPage(walk.source, stepQuery, walk.params, walk.viewer, walk.entry),
          },
        }
      : {}),
  };

  // `{{ results.total }}` resolves from the scope, and the scope was built once
  // for the page — so a step's own count has to reach it here or the sentence
  // renders with the number missing.
  const stepScope: Scope = stepWalk.primary
    ? { ...scope, results: stepWalk.primary.result }
    : scope;

  const rendered = here.step.blocks.map((b, j) => ({
    block: b,
    html: renderBlock(b, stepScope, [...path, here.index, j], stepWalk),
  }));

  // A step that asks rather than offers: "when are you coming?" collects two
  // dates and chooses nothing, and there was no way to answer it — so the first
  // screen of a booking journey could not be written.
  //
  // The blocks already put the parameters in the address, which is how every
  // filter on the site works. This posts them back so the step is answered, and
  // the controller returns them to the address so the next step still filters by
  // them. The button appears once every parameter has a value: a Continue that
  // continues to the same screen is worse than no button.
  const captures = here.step.captures ?? [];
  const captured = captures.map((name) => [name, String(walk.params[name] ?? "")] as const);
  const carry =
    captures.length > 0 && captured.every(([, value]) => value !== "")
      ? el(
          "form",
          { method: "post", action: `${action}/${here.step.key}`, class: "fx-flow-continue" },
          ...captured.map(([name, value]) => el("input", { type: "hidden", name, value })),
          el("button", { type: "submit", class: "fx-button" }, "Continue"),
        )
      : null;

  return el(
    "div",
    { class: "fx-flow", "data-flow": flow.key },
    trail,
    ...chosen,
    el(
      "section",
      { class: "fx-flow-step", "data-step": here.step.key },
      // A step that chooses posts its choice back; one that does not is
      // whatever its blocks are — usually the form that completes the journey.
      //
      // Blocks that own a form are left outside it. A date filter above the
      // rooms it filters is the obvious way to write this step, and nesting its
      // form inside the choose-form is markup a browser will not keep: it closes
      // the outer form early, and one of the two stops working.
      here.step.selects
        ? fragment(
            ...groupBy(rendered, (r) => walk.registry[r.block.type]?.ownsForm === true).map(
              (run) =>
                run.ownsForm
                  ? fragment(...run.items.map((r) => r.html))
                  : el(
                      "form",
                      {
                        method: "post",
                        action: `${action}/${here.step.key}`,
                        class: "fx-flow-choose",
                      },
                      ...run.items.map((r) => r.html),
                    ),
            ),
          )
        : fragment(...rendered.map((r) => r.html), carry),
    ),
  );
}

/**
 * Consecutive items that answer the same way, in order.
 *
 * A step's blocks keep the order the author wrote them in, so a filter above a
 * list stays above it — the runs are what decides which of them the choosing
 * form wraps, not a reordering.
 */
function groupBy<T>(
  items: readonly T[],
  ownsForm: (item: T) => boolean,
): { ownsForm: boolean; items: T[] }[] {
  const runs: { ownsForm: boolean; items: T[] }[] = [];
  for (const item of items) {
    const flag = ownsForm(item);
    const last = runs.at(-1);
    if (last && last.ownsForm === flag) last.items.push(item);
    else runs.push({ ownsForm: flag, items: [item] });
  }
  return runs;
}

/** A choice, as a line of text: its title if it has one, its id otherwise. */
function describeChoice(value: unknown): string {
  if (!value || typeof value !== "object") return String(value ?? "");
  const row = value as Record<string, unknown>;
  for (const key of ["name", "title", "label", "startsAt", "slug", "id"]) {
    const found = row[key];
    if (typeof found === "string" && found !== "") return found;
  }
  // A captured step's answer is the parameters it collected, which have none of
  // those names. Without this the summary line read "Your dates: " — the label,
  // a colon, and the reason people start a booking again.
  const values = Object.values(row).filter((v) => typeof v === "string" && v !== "");
  return values.join(" – ");
}

export interface RenderedPage {
  readonly html: string;
  readonly title: string;
}

export function renderPage(page: Page, options: RenderOptions, entry?: Entry): RenderedPage {
  const { spec, registry = CORE_BLOCKS, locale = DEFAULT_LOCALE } = options;
  // Derived types resolve once here, so every query on the page sees the same
  // rows. A page showing a slot as free in one place and taken in another would
  // be worse than either.
  // Params reach the source because a computed field may read them: "three
  // nights" is a request parameter, and the total depends on it.
  const source = withDerived(spec, options.source, options.now, options.params ?? {});
  const walk: Walk = {
    css: [],
    pageKey: page.key,
    ...(options.previewFlows ? { previewFlows: true } : {}),
    ...(options.viewer ? { viewer: options.viewer } : {}),
    // The row this page is for, so a `{ entry: … }` condition can name it.
    // Declared on `Walk` and read by three call sites, and for one release
    // never actually assigned — so every such filter quietly matched nothing
    // and a detail page showed none of its own rows.
    ...(entry ? { entry } : {}),
    registry,
    source,
    locale,
    spec,
    params: options.params ?? {},
    path: options.path ?? page.path,
  };

  // The page's own query, before any block renders — see `Walk.primary`.
  const primaryQuery = firstQuery(page.blocks);
  if (primaryQuery) {
    walk.primary = {
      query: primaryQuery,
      result: runQueryPage(source, primaryQuery, walk.params, walk.viewer, entry),
    };
  }
  const scope: Scope = {
    site: { name: spec.name },
    // `{{ flow.stylist.name }}` — the choices, in the shape ADR 0009 §3 wrote.
    ...(options.flow ? { flow: options.flow } : {}),
    // What the page's own query found, so any block can say it: a heading
    // reading "{{ results.total }} rooms free" needs no bespoke placeholder,
    // and `results-count`'s `{n}` stops being the only way to show a number.
    ...(walk.primary ? { results: walk.primary.result } : {}),
    ...(entry ? { entry } : {}),
  };

  // The site layout wraps every page unless it opts out (ADR 0014, decision 2).
  // Header and footer indices are offset so their generated class names cannot
  // collide with the page's own blocks.
  const layout = page.layout === "none" ? undefined : spec.layout;
  const body = fragment(
    ...(layout?.header ?? []).map((b, i) => renderBlock(b, scope, [9000 + i], walk)),
    ...page.blocks.map((b, i) => renderBlock(b, scope, [i], walk)),
    ...(page.flows ?? []).map((f, i) => renderFlow(f, scope, [1000 + i], walk)),
    ...(layout?.footer ?? []).map((b, i) => renderBlock(b, scope, [9500 + i], walk)),
  );

  const seo = pageSeo(spec, page, scope);
  const bound = collectionType(page.collection);
  const type = bound ? spec.content.find((t) => t.key === bound) : undefined;
  const jsonld = type && entry ? buildJsonLd(type, entry, spec.name) : undefined;

  const document = fragment(
    raw("<!doctype html>"),
    el(
      "html",
      // The site's own language, not English by assumption. A screen reader
      // picks its voice from this, and a crawler its market.
      { lang: spec.locale },
      el(
        "head",
        {},
        head({
          spec,
          title: seo.title,
          ...(seo.description ? { description: seo.description } : {}),
          ...(seo.image ? { image: seo.image } : {}),
          // The address this page actually has. `page.path` is the collection's
          // base — `/stay` — so every entry on a collection page told crawlers
          // its canonical version was the same URL as every other entry's.
          // That is the tag saying "these are all duplicates of one page".
          ...(options.canonicalBase
            ? { canonical: `${options.canonicalBase}${options.path ?? page.path}` }
            : {}),
          noindex: seo.noindex,
          ...(entry ? { entry: true } : {}),
          ...(jsonld ? { jsonld } : {}),
        }),
        el("style", {}, raw(siteCss(spec))),
        // Block CSS after site CSS so a block's own rules win, and after the
        // walk so only blocks that actually rendered contribute any.
        walk.css.length ? el("style", {}, raw(walk.css.join(""))) : null,
        page.css ? el("style", {}, raw(page.css)) : null,
        // Last in the head, after everything that decides what the page looks
        // like — an analytics tag must never be what delays a render.
        analytics(spec),
      ),
      el("body", {}, body),
    ),
  );

  return { html: toString(document), title: seo.title };
}

/** Every route this spec answers, including one per entry for collection pages. */
export interface RouteOptions {
  /** Injected so derived types render deterministically in tests. */
  readonly now?: Date;
  /** Passed through for computed fields; routes themselves do not read it. */
  readonly params?: Readonly<Record<string, string | readonly string[] | undefined>>;
  /**
   * Include pages marked `draft`.
   *
   * False everywhere except the admin's preview. `draft` has been in the schema
   * since the first version and nothing read it, so an unpublished page was
   * served to the public exactly like any other — the same defect entries had,
   * one level up.
   */
  readonly drafts?: boolean;
}

export function routes(
  spec: SiteSpec,
  source: EntrySource,
  options: RouteOptions | Date = {},
): { path: string; page: Page; entry?: Entry }[] {
  // A `Date` third argument is the old signature, kept working because the
  // renderer's tests and the CLI both call it that way.
  const settings: RouteOptions = options instanceof Date ? { now: options } : options;
  const resolved = withDerived(spec, source, settings.now, settings.params ?? {});
  const out: { path: string; page: Page; entry?: Entry }[] = [];

  for (const page of spec.pages) {
    if (page.draft && settings.drafts !== true) continue;
    const bound = collectionType(page.collection);
    if (!bound) {
      out.push({ path: page.path, page });
      continue;
    }
    // A collection page may filter which entries get a URL (ADR 0014, decision
    // 4) — so a retired service can either keep its address or stop resolving,
    // and the spec says which rather than the renderer deciding.
    const where = typeof page.collection === "string" ? undefined : page.collection?.where;
    const rows = resolved.all(bound).filter((row) => (where ?? []).every((c) => matches(row, c)));

    for (const entry of rows) {
      const slug = String(entry["slug"] ?? entry["id"] ?? "");
      if (slug) out.push({ path: `${page.path.replace(/\/$/, "")}/${slug}`, page, entry });
    }
  }
  return out;
}
