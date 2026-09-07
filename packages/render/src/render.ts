/**
 * The deterministic runtime: a spec plus rows in, HTML out.
 *
 * No model runs here. Doc 02's "Compiled AI" property is what makes the pricing
 * in ADR 0011 possible — the LLM runs at *edit* time, so a page view costs
 * nothing and a customer's site keeps serving whether or not anyone is paying
 * for inference (doc 13).
 */
import type { Block, Page, SiteSpec } from '@forinda-cms/spec'

import { CORE_BLOCKS, unknownBlock, type BlockType } from './blocks.js'
import { blockCss, siteCss } from './css.js'
import { matches, runQuery, type Entry, type EntrySource } from './entries.js'
import { el, fragment, raw, render as toString, type Html } from './html.js'
import { buildJsonLd, head, pageSeo } from './seo.js'
import { DEFAULT_LOCALE, resolveAttrs, type FormatLocale, type Scope } from './scope.js'

export interface RenderOptions {
  readonly spec: SiteSpec
  readonly source: EntrySource
  readonly registry?: Record<string, BlockType>
  readonly canonicalBase?: string
  /** Defaults to Kenya-first (doc 14). Moves into the spec in Phase 0b. */
  readonly locale?: FormatLocale
}

/**
 * A stable class per block position.
 *
 * Position-derived rather than random so that re-rendering the same spec
 * produces byte-identical output — which is what lets `fcms dev` diff a page and
 * what makes the eventual static-render path cacheable.
 */
function className(path: readonly number[]): string {
  return `b${path.join('-')}`
}

interface Walk {
  readonly css: string[]
  readonly registry: Record<string, BlockType>
  readonly source: EntrySource
  readonly locale: FormatLocale
}

function renderBlock(block: Block, scope: Scope, path: readonly number[], walk: Walk): Html {
  // `when` gates the whole subtree. Evaluated against the current scope, so a
  // condition inside an `item` sees that row.
  if (block.when && !matches(scope as Entry, block.when)) return raw('')

  const cls = className(path)
  const css = blockCss(cls, block.style, block.css)
  if (css) walk.css.push(css)

  // A `data` block renders `item` once per row instead of its children. The
  // schema guarantees the two travel together, so neither branch is partial.
  let children: Html
  if (block.data && block.item) {
    const rows = runQuery(walk.source, block.data)
    children = fragment(
      ...rows.map((row, i) =>
        fragment(
          ...block.item!.map((child, j) => renderBlock(child, { ...scope, item: row }, [...path, i, j], walk)),
        ),
      ),
    )
  } else {
    children = fragment(...(block.children ?? []).map((child, i) => renderBlock(child, scope, [...path, i], walk)))
  }

  const type = walk.registry[block.type]
  if (!type) return unknownBlock(block.type)

  return type.render({
    className: cls,
    attrs: resolveAttrs(block.attrs, scope, walk.locale),
    children,
    scope,
  })
}

/**
 * A flow, rendered as its steps.
 *
 * ADR 0007 is explicit that the spike renders a journey without completing one:
 * *"a flow that renders but cannot be completed is a successful spike"*. Without
 * persistence there is no step state to keep, so every step is emitted and
 * marked — enough to answer "can the spec express this booking journey", which
 * is the question Phase 0a exists to answer.
 */
function renderFlow(flow: NonNullable<Page['flows']>[number], scope: Scope, path: readonly number[], walk: Walk): Html {
  return el('div', { class: 'fx-flow', 'data-flow': flow.key },
    el('ol', { class: 'fx-flow-steps' },
      ...flow.steps.map((step, i) => el('li', { 'aria-current': i === 0 ? 'step' : undefined }, step.label ?? step.key))),
    ...flow.steps.map((step, i) =>
      el('section', { class: 'fx-flow-step', 'data-step': step.key, hidden: i !== 0 },
        ...step.blocks.map((b, j) => renderBlock(b, scope, [...path, i, j], walk)))),
  )
}

export interface RenderedPage {
  readonly html: string
  readonly title: string
}

export function renderPage(page: Page, options: RenderOptions, entry?: Entry): RenderedPage {
  const { spec, source, registry = CORE_BLOCKS, locale = DEFAULT_LOCALE } = options
  const walk: Walk = { css: [], registry, source, locale }
  const scope: Scope = { site: { name: spec.name }, ...(entry ? { entry } : {}) }

  const body = fragment(
    ...page.blocks.map((b, i) => renderBlock(b, scope, [i], walk)),
    ...(page.flows ?? []).map((f, i) => renderFlow(f, scope, [1000 + i], walk)),
  )

  const seo = pageSeo(spec, page, scope)
  const type = page.collection ? spec.content.find((t) => t.key === page.collection) : undefined
  const jsonld = type && entry ? buildJsonLd(type, entry, spec.name) : undefined

  const document = fragment(
    raw('<!doctype html>'),
    el('html', { lang: 'en' },
      el('head', {},
        head({
          spec,
          title: seo.title,
          ...(seo.description ? { description: seo.description } : {}),
          ...(seo.image ? { image: seo.image } : {}),
          ...(options.canonicalBase ? { canonical: `${options.canonicalBase}${page.path}` } : {}),
          noindex: seo.noindex,
          ...(jsonld ? { jsonld } : {}),
        }),
        el('style', {}, raw(siteCss(spec))),
        // Block CSS after site CSS so a block's own rules win, and after the
        // walk so only blocks that actually rendered contribute any.
        walk.css.length ? el('style', {}, raw(walk.css.join(''))) : null,
        page.css ? el('style', {}, raw(page.css)) : null,
      ),
      el('body', {}, body)),
  )

  return { html: toString(document), title: seo.title }
}

/** Every route this spec answers, including one per entry for collection pages. */
export function routes(spec: SiteSpec, source: EntrySource): { path: string; page: Page; entry?: Entry }[] {
  const out: { path: string; page: Page; entry?: Entry }[] = []
  for (const page of spec.pages) {
    if (!page.collection) {
      out.push({ path: page.path, page })
      continue
    }
    for (const entry of source.all(page.collection)) {
      const slug = String(entry['slug'] ?? entry['id'] ?? '')
      if (slug) out.push({ path: `${page.path.replace(/\/$/, '')}/${slug}`, page, entry })
    }
  }
  return out
}
