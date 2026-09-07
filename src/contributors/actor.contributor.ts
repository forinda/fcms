/**
 * Who is calling.
 *
 * Rejects by default. `enaton`'s comment on the same contributor records why,
 * and it is worth repeating: opting *into* authorization per route is how
 * `GET /organization` and two entire apps ended up publicly reachable without
 * anyone deciding they should be. The flag is the only way out, and it is
 * applied per surface rather than per route (ADR 0008 §4).
 *
 * This does not authorize. It establishes who is asking and that their session
 * is still live; what they may *do* is checked at the patch classifier, where
 * every authoring surface passes through one gate (ADR 0008 decision 2).
 */
import { defineHttpContextDecorator, getEnv, HttpException } from "@forinda/kickjs";
import { AuthenticateUseCase, createDb, type OwnerRow } from "@forinda-cms/db";

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

export const Actor = defineHttpContextDecorator({
  key: "actor",
  // The public site has no caller to identify; the login form is how a caller
  // becomes one. Everything else needs a session.
  skipWhen: ["site.public", "auth.public"],
  async resolve(ctx): Promise<OwnerRow> {
    const headers = ctx.req.headers as Record<string, string | string[] | undefined>;
    const raw = headers["cookie"];
    const cookie = Array.isArray(raw) ? raw[0] : raw;

    const owner = await new AuthenticateUseCase(createDb(getEnv("DATABASE_URL"))).execute(
      readCookie(cookie, SESSION_COOKIE),
    );

    if (!owner) throw new HttpException(401, "Sign in to continue.");
    return owner;
  },
});
