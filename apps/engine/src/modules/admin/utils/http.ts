/**
 * The admin's HTTP edge: reading a form in, writing a page out.
 *
 * Both controllers had their own copy of `html` and their own escape, and the
 * two had already drifted — the login page rendered a different `<head>` and a
 * second stylesheet for the same admin. One copy here, so a change to what the
 * admin sends lands everywhere at once.
 */
import { getEnv, type Ctx } from "@forinda/kickjs";
import { coerceEntryInput, type ContentType } from "@forinda-cms/spec";

import { SESSION_COOKIE } from "@/contributors/actor.contributor";
import { page } from "./view";

/** One header value, whether the runtime handed over a string or a list. */
export function firstHeader(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Who the request came from, for the session record.
 *
 * `ctx.req.ip` first: on Express that is the address the runtime resolved, and
 * it already accounts for the proxy setting. `X-Forwarded-For` is read only
 * when `TRUST_PROXY` says so and only its first hop — an unconditional read
 * lets any caller write their own address into the audit trail, and the site
 * contributor already applies that rule to the host header.
 *
 * KickJS has no public `ctx.ip` in v8.3.1 (its `resolveClientIp` is internal),
 * so this mirrors that precedence rather than reaching past the runtime.
 */
export function clientIp(ctx: Ctx): string | null {
  const req = ctx.req as { ip?: string; socket?: { remoteAddress?: string } };
  if (typeof req.ip === "string" && req.ip.length > 0) return req.ip;

  if (getEnv("TRUST_PROXY") === true) {
    const headers = ctx.req.headers as Record<string, string | string[] | undefined>;
    const forwarded = firstHeader(headers["x-forwarded-for"]);
    const hop = forwarded?.split(",")[0]?.trim();
    if (hop) return hop;
  }

  return req.socket?.remoteAddress ?? null;
}

/**
 * The session cookie.
 *
 * `HttpOnly` so script cannot read it, `SameSite=Lax` so a cross-site form POST
 * cannot ride it — which is the CSRF defence for a cookie-authenticated admin
 * with no separate token. `Secure` follows `SECURE_COOKIES`, off by default
 * because a first install is often plain HTTP on a LAN and a cookie marked
 * Secure there simply never arrives.
 */
export function sessionCookie(token: string, expiresAt: Date): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (getEnv("SECURE_COOKIES") === true) parts.push("Secure");
  return parts.join("; ");
}

export function expiredCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function html(ctx: Ctx, status: number, body: string): void {
  ctx.res.statusCode = status;
  ctx.res.setHeader("content-type", "text/html; charset=utf-8");
  // The admin is never a search result.
  ctx.res.setHeader("x-robots-tag", "noindex, nofollow");
  ctx.res.end(body);
}

export function redirect(ctx: Ctx, to: string): void {
  // 303, so a refresh after saving does not resubmit the form.
  ctx.res.statusCode = 303;
  ctx.res.setHeader("location", to);
  ctx.res.end();
}

/**
 * A screen that needs a site, on an install that has none yet.
 *
 * Not a 404: nothing is missing, the site simply has not been started. Sending
 * them to `/admin` puts them on the one screen that has something to offer
 * (ADR 0036), instead of a dead end reached by clicking a link the admin's own
 * navigation showed them.
 */
export function noSiteYet(ctx: Ctx): void {
  redirect(ctx, "/admin");
}

export function notFound(ctx: Ctx): void {
  html(ctx, 404, page({ title: "Not found", body: "<h1>Not found</h1>" }));
}

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/**
 * The week, out of the boxes it was filled in.
 *
 * An `hours` field is edited as a grid — a pair of time inputs per slot, named
 * `workingHours__tue__0__from` — because the alternative was a textarea of JSON,
 * which is not something to put in front of the person who runs a salon
 * (ADR 0039).
 *
 * The flat names are gathered back into `{ tue: [{ from, to }] }` here rather
 * than in the spec package, because the naming is this form's business and the
 * schema should never learn about it. A slot with only one end filled is kept
 * as it is so the schema refuses it — dropping it would silently save half of
 * what somebody typed.
 */
export function gatherHours(
  type: ContentType,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const hours = type.fields.filter((f) => f.type === "hours");
  if (hours.length === 0) return fields;

  const out: Record<string, unknown> = { ...fields };
  for (const field of hours) {
    const prefix = `${field.name}__`;
    const posted = Object.keys(fields).some((k) => k.startsWith(prefix));
    // Absent means the form did not render the grid — an API caller, or a
    // textarea from an older page. Leave whatever was sent alone.
    if (!posted) continue;

    const week: Record<string, { from: string; to: string }[]> = {};
    for (const day of DAYS) {
      const slots: { from: string; to: string }[] = [];
      for (let index = 0; ; index += 1) {
        const from = fields[`${prefix}${day}__${index}__from`];
        const to = fields[`${prefix}${day}__${index}__to`];
        if (from === undefined && to === undefined) break;

        const start = String(from ?? "").trim();
        const end = String(to ?? "").trim();
        if (start !== "" || end !== "") slots.push({ from: start, to: end });
      }
      if (slots.length > 0) week[day] = slots;
      delete out[`${prefix}${day}`];
    }

    for (const key of Object.keys(out)) if (key.startsWith(prefix)) delete out[key];
    out[field.name] = Object.keys(week).length > 0 ? week : undefined;
  }
  return out;
}

/** A non-empty string, or nothing — an empty input is an absent slug, not "". */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * One posted entry form, as the writer wants it.
 *
 * `__slug` is the form's control, not a field, so it is taken out before the
 * body meets the schema — `coerceEntryInput` is strict, and leaving it in
 * failed every save with `Unrecognized key: "__slug"`.
 */
export function readForm(
  ctx: Ctx,
  type: ContentType,
): { slug: string | undefined; data: Record<string, unknown> } {
  const { __slug, ...fields } = (ctx.body ?? {}) as Record<string, unknown>;

  // Coerced here so a re-rendered form shows what the schema saw, not the raw
  // strings — otherwise a rejected number field redisplays differently from how
  // it was judged.
  const data = coerceEntryInput(type, gatherHours(type, fields));

  // The address comes from the declared `slug` field where there is one. Both
  // end up in the row: the column is what the URL and the unique index read,
  // the field is what the spec declared, and the repository merges the column
  // back over the data on the way out.
  return { slug: text(data["slug"]) ?? text(__slug), data };
}
