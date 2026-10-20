import { randomBytes } from "node:crypto";

import { getEnv, requestId, session, type MiddlewareEntry } from "@forinda/kickjs";
// The eager runtime, not the root export: that one loads Express lazily, and
// asking it for parsers while this module loads throws in a production bundle
// — `kick dev` has Express loaded by then, which is how it hid.
import { expressRuntime } from "@forinda/kickjs/express";

/**
 * The admin's flash cookie (ADR 0051 §5).
 *
 * Mounted at `/admin` only, and never written until something is put in it: a
 * cookie on every public page is a page no cache will hold, for a feature no
 * visitor uses.
 *
 * `store: "cookie"` keeps the data in the cookie itself, encrypted, so there is
 * no table and nothing to share between instances.
 */
const adminSession = session({
  // ponytail: a per-boot secret when SESSION_SECRET is unset — fine for one
  // process, drops in-flight flash on restart; multi-instance must set it.
  secret: getEnv("SESSION_SECRET") ?? randomBytes(32).toString("hex"),
  store: "cookie",
  cookieName: "fcms_flash",
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: getEnv("SECURE_COOKIES") === true },
});

/**
 * Naming any middleware replaces the framework's defaults rather than adding
 * to them, so the two it would have mounted — a request id, and the body
 * parsers every form on the admin posts through — are named here too.
 */
export const middlewares: MiddlewareEntry[] = [
  requestId(),
  // Typed as connect middleware of either arity; Express's parsers are all
  // the three-argument kind.
  ...((expressRuntime().bodyParsers?.({ limit: "1mb" }) ?? []) as MiddlewareEntry[]),
  { path: "/admin", handler: adminSession },
];
