/**
 * Parse: YAML text → a validated `SiteSpec`, or diagnostics that point at lines.
 *
 * The whole value of this file is the last clause. Zod knows a `limit` is
 * missing and at which *path*; the YAML document knows which *offset* that path
 * occupies. Joining them is what turns "Required at pages.1.blocks.0.data.limit"
 * into something with a line number an editor can jump to.
 */
import { LineCounter, isNode, parseAllDocuments, type Document } from 'yaml'
import { validateSpec, type SiteSpec } from '@forinda-cms/spec'

import type { Diagnostic } from './errors.js'
import { STRICT_PARSE_OPTIONS, checkProfile, checkUnquotedTemplates } from './profile.js'

export type ParseResult =
  | { readonly ok: true; readonly spec: SiteSpec }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

/**
 * Find the source position for a spec path, walking up until something is found.
 *
 * The fallback matters more than the exact hit. When a *required key is missing*
 * there is no node at its path — so we point at the nearest ancestor that does
 * exist, which reads as "on this block, `limit` is required" rather than
 * "somewhere in this file". That is the common case, not the edge case.
 */
function locatePath(
  doc: Document,
  lineCounter: LineCounter,
  path: readonly (string | number)[],
): { line?: number; col?: number } {
  for (let end = path.length; end >= 0; end--) {
    const node = end === 0 ? doc.contents : doc.getIn(path.slice(0, end), true)
    const offset = isNode(node) ? node.range?.[0] : undefined
    if (offset !== undefined) return lineCounter.linePos(offset)
  }
  return {}
}

/**
 * A bare `{{ … }}` starts a YAML flow mapping, so an unquoted template is a
 * parse error with a message about braces that says nothing useful.
 *
 * Templating appears throughout `logic` and every text attr, so this is the most
 * likely mistake anyone makes in this language — worth detecting by hand. The
 * printer quotes these unconditionally (ADR 0006 rule 5); this is for text a
 * human typed.
 */
function templateHint(source: string, line?: number): string | undefined {
  if (line === undefined) return undefined
  const text = source.split(/\r?\n/)[line - 1]
  if (text && /\{\{/.test(text) && !/["']/.test(text)) {
    return 'a value containing `{{` must be quoted — `heading: "{{ item.name }}"` — because `{` opens a YAML flow mapping.'
  }
  return undefined
}

/** Parse one document's worth of spec text. `file` only decorates diagnostics. */
export function parseSpec(source: string, file?: string): ParseResult {
  const lineCounter = new LineCounter()
  const docs = parseAllDocuments(source, { ...STRICT_PARSE_OPTIONS, lineCounter })

  const withFile = (d: Diagnostic): Diagnostic => (file ? { ...d, file } : d)

  // Rule 3 — a spec file is exactly one document. `---` separators are a way to
  // smuggle several specs into one file and there is no meaning for the second.
  if (docs.length > 1) {
    const second = docs[1]!
    const pos = second.range ? lineCounter.linePos(second.range[0]) : {}
    return {
      ok: false,
      diagnostics: [
        withFile({
          path: '/',
          message: 'multiple YAML documents in one file',
          ...pos,
          hint: 'remove the `---` separator; one file holds one document.',
        }),
      ],
    }
  }

  const doc = docs[0]
  if (!doc || doc.contents === null) {
    return { ok: false, diagnostics: [withFile({ path: '/', message: 'the file is empty' })] }
  }

  // Raw parser errors first — nothing downstream is meaningful if the text did
  // not parse. These are the ones with poor messages, so this is where the
  // template hint earns its place.
  if (doc.errors.length > 0) {
    return {
      ok: false,
      diagnostics: doc.errors.map((e) => {
        const pos = lineCounter.linePos(e.pos[0])
        const hint = templateHint(source, pos.line)
        return withFile({ path: '/', message: e.message, ...pos, ...(hint ? { hint } : {}) })
      }),
    }
  }

  const profile = [
    ...checkUnquotedTemplates(source),
    ...checkProfile(doc, (offset) => (offset === undefined ? {} : lineCounter.linePos(offset))),
  ]
  if (profile.length > 0) return { ok: false, diagnostics: profile.map(withFile) }

  const result = validateSpec(doc.toJS())
  if (result.ok) return { ok: true, spec: result.spec }

  return {
    ok: false,
    diagnostics: result.issues.map((issue) => {
      const segments = issue.path.split('/').filter(Boolean).map((s) => (/^\d+$/.test(s) ? Number(s) : s))
      return withFile({ path: issue.path, message: issue.message, ...locatePath(doc, lineCounter, segments) })
    }),
  }
}
