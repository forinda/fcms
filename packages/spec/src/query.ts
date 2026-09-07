/**
 * `data` — the only way a block gets rows, and the only iteration in the spec.
 *
 * This is Gutenberg's Query Loop and Webflow's Collection List: the
 * best-understood pattern in the category, and it is data rather than code
 * (ADR 0009 §1). There is no `for`; `data` + `item` is the whole story.
 */
import { z } from "zod";

import { Condition } from "./condition.js";
import { FieldName, Key } from "./primitives.js";

/**
 * Hard ceiling on `limit`.
 *
 * ADR 0009 makes the limit mandatory *and* capped because an unbounded query is
 * a performance bug the owner cannot see — the page just gets slower as their
 * business grows, which is the worst possible time for it to happen.
 */
export const MAX_LIMIT = 100;

export const Sort = z
  .object({ field: FieldName, dir: z.enum(["asc", "desc"]).default("asc") })
  .strict();

/**
 * Sort chosen by the visitor, from a list the author closed.
 *
 * `allow` is a closed set for the reason tier-2 styling is enums (ADR 0004): an
 * open sort field is an ordering over any column, which is a query planner the
 * author did not write and cannot see the cost of.
 */
export const SortByParam = z
  .object({
    param: z.string().regex(/^[a-z][a-z0-9_]*$/, "a lowercase parameter name"),
    allow: z.array(FieldName).min(1).max(10),
    default: FieldName.optional(),
    dir: z.enum(["asc", "desc"]).default("asc"),
  })
  .strict();

/**
 * Paging, driven by the request.
 *
 * `limit` becomes the page size and `MAX_LIMIT` still caps it: ADR 0009's
 * argument that an unbounded query is a performance bug the owner cannot see
 * gets stronger with four hundred rows, not weaker.
 */
export const Paging = z
  .object({
    param: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/, "a lowercase parameter name")
      .default("page"),
  })
  .strict();

export const Query = z
  .object({
    /** A declared content type. The query follows declared relations or it does not run. */
    from: Key,
    /** Top-level AND only in v1. OR groups stay structured if they are ever added. */
    where: z.array(Condition).max(10).optional(),
    sort: z.union([Sort, SortByParam]).optional(),
    /** Present when the visitor pages through results rather than seeing the first N. */
    page: Paging.optional(),
    limit: z.number().int().min(1).max(MAX_LIMIT),
  })
  .strict();

export type Query = z.infer<typeof Query>;
