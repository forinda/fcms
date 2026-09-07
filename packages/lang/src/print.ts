/**
 * The canonical printer — `fcms fmt`, and the half of `fcms pull` that turns the
 * database back into text.
 *
 * gofmt's lesson, which ADR 0006 adopts: **one canonical formatting is what makes
 * `pull` output stable and diffs meaningful.** Without it, every pull produces
 * spurious changes and the agency workflow in doc 12 — a spec in git, applied
 * across clients — stops working.
 *
 * Two rules do the work:
 *
 * - **Key order is schema-defined, not alphabetical** (rule 6). `type` before
 *   `attrs` before `children` reads in the order a person thinks about a block;
 *   alphabetical would put `attrs` first and `children` in the middle.
 * - **Strings containing `{{` are always quoted** (rule 5), unconditionally,
 *   because `{` opens a flow mapping. The printer never has to decide.
 */
import { Document, Scalar, YAMLMap, isMap, isSeq, visit } from 'yaml'

import type { Diagnostic } from './errors.js'
import { parseSpec } from './parse.js'

/**
 * Canonical key order per node kind, keyed by a field that identifies the kind.
 * Anything unlisted keeps its insertion order after the listed keys, so adding a
 * field to the schema does not silently reorder existing files.
 */
const KEY_ORDER: Record<string, readonly string[]> = {
  root: ['specVersion', 'name', 'theme', 'css', 'content', 'pages', 'logic', 'access', 'wiring'],
  block: ['type', 'layout', 'style', 'when', 'data', 'attrs', 'item', 'children', 'css'],
  page: ['key', 'path', 'title', 'collection', 'draft', 'seo', 'blocks', 'flows', 'css'],
  contentType: ['key', 'label', 'labelPlural', 'titleField', 'publishable', 'permalink', 'jsonld', 'fields'],
  field: ['name', 'label', 'type', 'required', 'unique', 'filterable', 'help'],
  workflow: ['key', 'label', 'enabled', 'trigger', 'steps'],
  step: ['action', 'when', 'params'],
  flow: ['key', 'steps', 'onComplete'],
  flowStep: ['key', 'label', 'requires', 'when', 'blocks'],
  query: ['from', 'where', 'sort', 'limit'],
  condition: ['field', 'op', 'value'],
  integration: ['key', 'kind', 'label', 'enabled', 'config', 'secrets'],
}

/** Identify a map by its distinguishing keys, so the right order applies. */
function kindOf(map: YAMLMap): keyof typeof KEY_ORDER | undefined {
  const has = (k: string) => map.has(k)
  if (has('specVersion')) return 'root'
  if (has('from') && has('limit')) return 'query'
  if (has('field') && has('op')) return 'condition'
  if (has('type') && (has('attrs') || has('children') || has('style') || has('data'))) return 'block'
  if (has('path') && has('blocks')) return 'page'
  if (has('fields') && has('key')) return 'contentType'
  if (has('trigger') && has('steps')) return 'workflow'
  if (has('steps') && has('key')) return 'flow'
  if (has('blocks') && has('key')) return 'flowStep'
  if (has('kind') && has('key')) return 'integration'
  if (has('action')) return 'step'
  if (has('name') && has('type')) return 'field'
  if (has('type') && has('children')) return 'block'
  return undefined
}

function reorder(map: YAMLMap): void {
  const kind = kindOf(map)
  if (!kind) return
  const order = KEY_ORDER[kind]!
  const rank = (k: unknown) => {
    const i = order.indexOf(String(k))
    return i === -1 ? order.length : i
  }
  map.items.sort((a, b) => {
    const ka = a.key instanceof Scalar ? a.key.value : a.key
    const kb = b.key instanceof Scalar ? b.key.value : b.key
    return rank(ka) - rank(kb)
  })
}

/** Rule 5. A template must survive a round-trip, so quoting is unconditional. */
function quoteTemplates(node: Scalar): void {
  if (typeof node.value === 'string' && node.value.includes('{{')) {
    node.type = Scalar.QUOTE_DOUBLE
  }
}

/**
 * A leaf map — no nested collections — may print in flow style if it is short.
 * `{ base: 1, md: 3 }` on one line is easier to read than three, and it is the
 * shape most conditions and layouts take.
 */
const FLOW_WIDTH = 60

function maybeFlow(map: YAMLMap): void {
  const leaf = map.items.every((p) => !isMap(p.value) && !isSeq(p.value))
  if (!leaf || map.items.length === 0 || map.items.length > 4) return
  const width = map.items.reduce((n, p) => {
    const k = p.key instanceof Scalar ? String(p.key.value) : ''
    const v = p.value instanceof Scalar ? String(p.value.value) : ''
    return n + k.length + v.length + 4
  }, 0)
  if (width <= FLOW_WIDTH) map.flow = true
}

/** Canonicalise a document in place: key order, template quoting, flow leaves. */
export function canonicalise(doc: Document): void {
  visit(doc, {
    Map(_key, node) {
      if (isMap(node)) {
        reorder(node)
        maybeFlow(node)
      }
    },
    Scalar(_key, node) {
      if (node instanceof Scalar) quoteTemplates(node)
    },
  })
}

/**
 * Print a spec object as canonical YAML.
 *
 * `pull` is a pure function of the spec (ADR 0006), which is why this takes a
 * plain object rather than editing source text: there is no formatting or
 * provenance to preserve, only meaning. The gofmt bargain — `fmt` may move
 * things — is what keeps round-tripping honest rather than approximate.
 */
export function printSpec(value: unknown): string {
  const doc = new Document(value, { version: '1.2', schema: 'core' })
  canonicalise(doc)
  return doc.toString({
    indent: 2,
    lineWidth: 100,
    minContentWidth: 20,
    defaultStringType: Scalar.PLAIN,
    defaultKeyType: Scalar.PLAIN,
    singleQuote: false,
  })
}

/**
 * `fcms fmt` — reformat text that already exists.
 *
 * Deliberately round-trips through plain JS rather than editing the source tree:
 * the output is then a pure function of *meaning*, exactly as `pull` is, so
 * formatting a pulled file and pulling it again produce identical bytes. That
 * property is the whole point of having a canonical printer.
 *
 * Comments do not survive. ADR 0006 accepts that — meaning round-trips,
 * formatting and comments do not — and research/11 recommends storing an
 * author's "why is this here" note as a spec field instead of a comment.
 *
 * Returns diagnostics rather than throwing when the source does not parse, so a
 * broken file is reported the same way as everywhere else.
 */
export function formatSource(source: string): { ok: true; text: string } | { ok: false; diagnostics: readonly Diagnostic[] } {
  const result = parseSpec(source)
  if (!result.ok) return { ok: false, diagnostics: result.diagnostics }
  return { ok: true, text: printSpec(result.spec) }
}
