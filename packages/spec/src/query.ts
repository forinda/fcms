/**
 * `data` — the only way a block gets rows, and the only iteration in the spec.
 *
 * This is Gutenberg's Query Loop and Webflow's Collection List: the
 * best-understood pattern in the category, and it is data rather than code
 * (ADR 0009 §1). There is no `for`; `data` + `item` is the whole story.
 */
import { z } from 'zod'

import { Condition } from './condition.js'
import { Key } from './primitives.js'

/**
 * Hard ceiling on `limit`.
 *
 * ADR 0009 makes the limit mandatory *and* capped because an unbounded query is
 * a performance bug the owner cannot see — the page just gets slower as their
 * business grows, which is the worst possible time for it to happen.
 */
export const MAX_LIMIT = 100

export const Sort = z.object({ field: Key, dir: z.enum(['asc', 'desc']).default('asc') }).strict()

export const Query = z
  .object({
    /** A declared content type. The query follows declared relations or it does not run. */
    from: Key,
    /** Top-level AND only in v1. OR groups stay structured if they are ever added. */
    where: z.array(Condition).max(10).optional(),
    sort: Sort.optional(),
    limit: z.number().int().min(1).max(MAX_LIMIT),
  })
  .strict()

export type Query = z.infer<typeof Query>
