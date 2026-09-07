/**
 * Route flags — named facts about a route that any consumer can read.
 *
 * KickJS ships no authentication and no tenancy; it ships these primitives and
 * the contributors that consume them (ADR 0008). `kick typegen` collects every
 * `defineRouteFlag` call into `KickRouteFlags`, so a typo in `skipWhen` is a
 * compile error rather than a flag that silently never matches.
 */
import { defineRouteFlag } from "@forinda/kickjs";

/**
 * This route serves the public rendered site.
 *
 * ADR 0008 §4: a CMS inverts the usual default. Most routes here *are* public —
 * the whole rendered site — so flagging every one of them `auth.public` would
 * defeat the safety of a deny-by-default rule by making the exception the norm.
 * The flag is split by **surface** instead: one public tree, one deny-by-default
 * tree, and no per-route decisions to forget.
 */
export const PublicSite = defineRouteFlag("site.public");
