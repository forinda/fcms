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

  return type.render({
    className: cls,
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
  });
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
  const stepWalk: Walk = here.step.selects ? { ...walk, selecting: here.step.selects.from } : walk;

  const blocks = here.step.blocks.map((b, j) =>
    renderBlock(b, scope, [...path, here.index, j], stepWalk),
  );

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
      here.step.selects
        ? el(
            "form",
            { method: "post", action: `${action}/${here.step.key}`, class: "fx-flow-choose" },
            ...blocks,
          )
        : fragment(...blocks),
    ),
  );
}

/** A choice, as a line of text: its title if it has one, its id otherwise. */
function describeChoice(value: unknown): string {
  if (!value || typeof value !== "object") return String(value ?? "");
  const row = value as Record<string, unknown>;
  for (const key of ["name", "title", "label", "startsAt", "slug", "id"]) {
    const found = row[key];
    if (typeof found === "string" && found !== "") return found;
  }
  return "";
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
      { lang: "en" },
      el(
        "head",
        {},
        head({
          spec,
          title: seo.title,
          ...(seo.description ? { description: seo.description } : {}),
          ...(seo.image ? { image: seo.image } : {}),
          ...(options.canonicalBase ? { canonical: `${options.canonicalBase}${page.path}` } : {}),
          noindex: seo.noindex,
          ...(jsonld ? { jsonld } : {}),
        }),
        el("style", {}, raw(siteCss(spec))),
        // Block CSS after site CSS so a block's own rules win, and after the
        // walk so only blocks that actually rendered contribute any.
        walk.css.length ? el("style", {}, raw(walk.css.join(""))) : null,
        page.css ? el("style", {}, raw(page.css)) : null,
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
