/**
 * Who is calling.
 *
 * Rejects by default, and the reason is worth stating: opting *into*
 * authorization per route is how
 * `GET /organization` and two entire apps ended up publicly reachable without
 * anyone deciding they should be. The flag is the only way out, and it is
 * applied per surface rather than per route (ADR 0008 §4).
 *
 * This does not authorize. It establishes who is asking and that their session
 * is still live; what they may *do* is checked at the patch classifier, where
 * every authoring surface passes through one gate (ADR 0008 decision 2).
 */
import { defineHttpContextDecorator, HttpException } from "@forinda/kickjs";
import type { OwnerRow } from "@forinda-cms/db";

import { AuthenticateUseCase } from "@/shared/auth/auth.usecase";

export const SESSION_COOKIE = "fcms_session";

declare module "@forinda/kickjs" {
  interface ContextMeta {
    /**
     * The signed-in owner.
     *
     * Never null: the contributor either resolves one or throws 401. On a
     * flagged route it does not run at all, so `ctx.get("actor")` is undefined
     * there and `ctx.require("actor")` is the right call everywhere else.
     */
    actor: OwnerRow;
  }
}

/** Read one cookie without a parser dependency. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/**
 * The session token, from a browser or from a terminal.
 *
 * Two carriers, one session: the admin sends a cookie, `fcms` sends
 * `Authorization: Bearer`. Both resolve through the same hashed-token lookup,
 * so a CLI session can be listed and revoked exactly like a browser one — a
 * separate API-key table would be a second credential to expire, audit and get
 * wrong.
 *
 * The bearer header is read first: a request that states its credential
 * explicitly means it, and a stale cookie in the same request should not win.
 */
export function sessionToken(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const auth = headers["authorization"];
  const header = Array.isArray(auth) ? auth[0] : auth;
  const bearer = header?.match(/^Bearer (.+)$/i)?.[1]?.trim();
  if (bearer) return bearer;

  const raw = headers["cookie"];
  return readCookie(Array.isArray(raw) ? raw[0] : raw, SESSION_COOKIE);
}

export const Actor = defineHttpContextDecorator({
  key: "actor",
  // The public site has no caller to identify; the login form is how a caller
  // becomes one. Everything else needs a session.
  skipWhen: ["site.public", "auth.public"],
  // The use-case class *is* the token — `@Service` registered it, so there is
  // no separate token to keep in step with it. This runs on every authenticated
  // request, and a contributor that builds its own collaborators is one nothing
  // can substitute.
  deps: { authenticate: AuthenticateUseCase },
  async resolve(ctx, { authenticate }): Promise<OwnerRow> {
    const headers = ctx.req.headers as Record<string, string | string[] | undefined>;
    const owner = await authenticate.execute(sessionToken(headers));

    if (!owner) throw new HttpException(401, "Sign in to continue.");
    return owner;
  },
});
