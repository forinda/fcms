/**
 * Pages — routes and the block tree.
 *
 * The canonical node shape uses an explicit `type` discriminator rather than a
 * single-key map (ADR 0006). The single-key form reads better; it was rejected
 * because uniformity beats elegance when a machine co-authors and a printer must
 * be canonical, and because a discriminated shape validates directly against a
 * JSON Schema generated from these definitions.
 */
import { z } from 'zod'

import { Key, Label, Path, TemplateString } from './primitives.js'
import { Query } from './query.js'
import { CustomCss, Layout, StyleProps } from './style.js'
import { When } from './condition.js'

/**
 * A block. Recursive, hence `z.lazy`.
 *
 * `attrs` is intentionally open: block types are a *registry*, populated by core
 * in Phase 0 and by plugins later (ADR 0002 seam 3). Validating a block's attrs
 * against its declared schema happens at registry lookup, not here — this schema
 * knows the shape of a block, not the vocabulary of every block type.
 */
export interface Block {
  type: string
  layout?: z.infer<typeof Layout>
  style?: z.infer<typeof StyleProps>
  attrs?: Record<string, unknown>
  when?: z.infer<typeof When>
  data?: z.infer<typeof Query>
  /** Rendered once per row when `data` is present, with `item.*` in scope. */
  item?: Block[]
  children?: Block[]
  css?: string
}

export const Block: z.ZodType<Block> = z.lazy(() =>
  z
    .object({
      type: Key,
      layout: Layout.optional(),
      style: StyleProps.optional(),
      attrs: z.record(z.string(), z.unknown()).optional(),
      when: When.optional(),
      data: Query.optional(),
      item: z.array(Block).optional(),
      children: z.array(Block).optional(),
      /** Tier 3, auto-scoped to this block instance by the renderer (ADR 0004). */
      css: CustomCss.optional(),
    })
    .strict()
    .superRefine((b, ctx) => {
      if (b.item && !b.data) {
        ctx.addIssue({ code: 'custom', message: '`item` needs a `data` query to iterate' })
      }
      if (b.data && !b.item) {
        ctx.addIssue({ code: 'custom', message: '`data` needs an `item` template to render rows' })
      }
    }),
)

/**
 * Nesting depth for `data` inside `item`.
 *
 * ADR 0009 caps this at one level in v1: a query inside a row template issues a
 * query per row, so two levels is an N+1 the author cannot see and the owner
 * pays for. Enforced as a tree walk rather than a type because the recursion is
 * unbounded.
 */
export const MAX_DATA_NESTING = 1

export function dataNestingDepth(blocks: readonly Block[], current = 0): number {
  let deepest = current
  for (const b of blocks) {
    const here = b.data ? current + 1 : current
    deepest = Math.max(deepest, here)
    if (b.item) deepest = Math.max(deepest, dataNestingDepth(b.item, here))
    if (b.children) deepest = Math.max(deepest, dataNestingDepth(b.children, here))
  }
  return deepest
}

/**
 * A multi-step sequence (ADR 0009 §3). The booking journey is one, and without
 * this the chosen vertical needs code.
 *
 * Flow *state* is platform-managed — the spec declares the shape, never the
 * state machine's implementation.
 */
export const FlowStep = z
  .object({
    key: Key,
    label: Label.optional(),
    /** Steps that must be answered before this one is reachable. */
    requires: z.array(Key).optional(),
    when: When.optional(),
    blocks: z.array(Block).min(1),
  })
  .strict()

export const Flow = z
  .object({
    key: Key,
    steps: z.array(FlowStep).min(2),
    /** Handed to the same action registry `logic` uses. */
    onComplete: z.array(z.object({ action: Key, params: z.record(z.string(), z.unknown()).optional() }).strict()).optional(),
  })
  .strict()
  .superRefine((f, ctx) => {
    const seen = new Set<string>()
    for (const step of f.steps) {
      for (const need of step.requires ?? []) {
        // A step may only require an *earlier* step: forward references make the
        // flow unorderable and are almost always a typo.
        if (!seen.has(need)) {
          ctx.addIssue({
            code: 'custom',
            message: `step "${step.key}" requires "${need}", which does not come before it`,
          })
        }
      }
      seen.add(step.key)
    }
  })

/** Per-page SEO. Templated so a type's pages get sane defaults without editing each one (doc 08). */
export const PageSeo = z
  .object({
    title: TemplateString.optional(),
    description: TemplateString.optional(),
    image: z.string().regex(/^asset:/).optional(),
    noindex: z.boolean().default(false),
  })
  .strict()

export const Page = z
  .object({
    key: Key,
    path: Path,
    title: Label,
    /** Bind the page to one entry of a type — `/services/{slug}` renders per service. */
    collection: Key.optional(),
    seo: PageSeo.optional(),
    blocks: z.array(Block),
    flows: z.array(Flow).optional(),
    css: CustomCss.optional(),
    draft: z.boolean().default(false),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (dataNestingDepth(p.blocks) > MAX_DATA_NESTING) {
      ctx.addIssue({
        code: 'custom',
        message:
          `page "${p.key}" nests \`data\` more than ${MAX_DATA_NESTING} level deep. ` +
          `A query inside a row template runs once per row — flatten it, or move the ` +
          `inner list into a block type.`,
      })
    }
  })

export type Page = z.infer<typeof Page>
export type Flow = z.infer<typeof Flow>
