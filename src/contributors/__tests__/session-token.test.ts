/**
 * Which credential a request is carrying.
 *
 * One session, two carriers: the admin sends a cookie, `fcms` sends a bearer
 * token. The rules here are small and the failures are quiet — a header parsed
 * loosely would accept `Bearer` with an empty token, and a cookie preferred
 * over an explicit header would sign a CLI call in as whoever last used the
 * browser on that machine.
 */
import { describe, expect, it } from "vitest";

import { readCookie, SESSION_COOKIE, sessionToken } from "../actor.contributor";

describe("reading the session token", () => {
  it("takes a bearer token", () => {
    expect(sessionToken({ authorization: "Bearer abc123" })).toBe("abc123");
  });

  it("accepts the scheme in any case, as the spec requires", () => {
    expect(sessionToken({ authorization: "bearer abc123" })).toBe("abc123");
  });

  it("takes the cookie when there is no header", () => {
    expect(sessionToken({ cookie: `${SESSION_COOKIE}=cookie-token` })).toBe("cookie-token");
  });

  it("prefers the header, because an explicit credential means it", () => {
    expect(
      sessionToken({ authorization: "Bearer header-token", cookie: `${SESSION_COOKIE}=stale` }),
    ).toBe("header-token");
  });

  it("ignores a header that carries no token", () => {
    expect(sessionToken({ authorization: "Bearer" })).toBeUndefined();
    expect(sessionToken({ authorization: "Bearer   " })).toBeUndefined();
    expect(sessionToken({ authorization: "Basic dXNlcjpwdw==" })).toBeUndefined();
  });

  it("resolves nothing when the request carries neither", () => {
    expect(sessionToken({})).toBeUndefined();
  });

  it("takes the first value when a header arrives as a list", () => {
    expect(sessionToken({ authorization: ["Bearer first", "Bearer second"] })).toBe("first");
  });
});

describe("reading one cookie", () => {
  it("finds the session among others, and decodes it", () => {
    const header = `theme=dark; ${SESSION_COOKIE}=a%2Fb%2Bc; other=1`;
    expect(readCookie(header, SESSION_COOKIE)).toBe("a/b+c");
  });

  it("does not match a cookie whose name merely ends with the same text", () => {
    expect(readCookie(`not_${SESSION_COOKIE}=x`, SESSION_COOKIE)).toBeUndefined();
  });
});
