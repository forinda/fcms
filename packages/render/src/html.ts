/**
 * HTML output primitives.
 *
 * **Auto-escaping is not optional.** Doc 05 makes it a rule: templates escape by
 * default with an explicit, audited opt-out, because themes and templates are
 * the single biggest XSS surface in classic CMSes. Here the exposure is worse
 * than usual — a `data` query renders rows written by site visitors (a booking
 * with a customer's name in it), so unescaped output is a stored-XSS hole by
 * construction rather than by mistake.
 *
 * There is exactly one opt-out, `raw()`, and its only caller is the `richtext`
 * field type. Anything else that wants it is a bug.
 */

/** An HTML fragment that has already been escaped or is trusted. */
export type Html = { readonly __html: string }

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function esc(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]!)
}

/**
 * The audited opt-out. Marks a string as already-safe HTML.
 *
 * Phase 0a trusts `richtext` because it is authored by the site owner through
 * the admin, not submitted by a visitor. **That assumption breaks the moment a
 * visitor-submitted field is rendered as richtext**, so Phase 0b must sanitise
 * here rather than trust — noted at the call site too.
 */
export function raw(html: string): Html {
  return { __html: html }
}

function toHtml(child: Html | string | null | undefined): string {
  if (child === null || child === undefined) return ''
  return typeof child === 'string' ? esc(child) : child.__html
}

const VOID_ELEMENTS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source'])

export type Attrs = Record<string, string | number | boolean | null | undefined>

export function attrs(input: Attrs): string {
  const out: string[] = []
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined || value === false) continue
    // Refuse event handlers and javascript: URLs outright. A block type should
    // never produce one, so reaching here means a bug or an injection attempt.
    if (/^on/i.test(key)) continue
    if (typeof value === 'string' && /^\s*javascript:/i.test(value)) continue
    out.push(value === true ? ` ${esc(key)}` : ` ${esc(key)}="${esc(value)}"`)
  }
  return out.join('')
}

export function el(tag: string, a: Attrs = {}, ...children: (Html | string | null | undefined)[]): Html {
  const open = `<${tag}${attrs(a)}>`
  if (VOID_ELEMENTS.has(tag)) return raw(open)
  return raw(`${open}${children.map(toHtml).join('')}</${tag}>`)
}

export function fragment(...children: (Html | string | null | undefined)[]): Html {
  return raw(children.map(toHtml).join(''))
}

export function render(node: Html): string {
  return node.__html
}
