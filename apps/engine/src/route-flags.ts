/**
 * Route flags — named facts about a route that any consumer can read.
 *
 * KickJS ships no authentication; it ships these primitives and the contributors
 * that consume them (ADR 0008 §4). `kick typegen` collects every
 * `defineRouteFlag` call into `KickRouteFlags`, so a typo in `skipWhen` is a
 * compile error rather than a flag that silently never matches.
 */
import { defineRouteFlag } from "@forinda/kickjs";

/**
 * The public rendered site.
 *
 * ADR 0008 §4: a CMS inverts the usual default. Most routes *are* public — the
 * whole rendered site — so flagging each one `auth.public` would make the
 * exception the norm and defeat a deny-by-default rule by volume. The flag is
 * split by **surface** instead: one public tree, one deny-by-default tree, and
 * no per-route decisions to forget.
 */
export const PublicSite = defineRouteFlag("site.public");

/**
 * A route inside the authenticated surface that must stay reachable without a
 * session — the login form and its POST, and nothing else.
 *
 * Deliberately narrow. This is the only way past the actor contributor, and
 * every use of it should be obvious from its name.
 */
export const PublicAuth = defineRouteFlag("auth.public");
