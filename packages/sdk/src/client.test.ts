/**
 * Client tests.
 *
 * `fetch` is injected, so these check the things a live server would not tell
 * you clearly: that the token travels as a bearer header, that a refusal keeps
 * its status so a caller can act on it, and that a server's own message
 * survives instead of being replaced by a generic one.
 */
import { describe, expect, it } from "vitest";
import { SiteSpec } from "@forinda-cms/spec";

import { ApiError, Client } from "./index.js";

const spec = SiteSpec.parse({
  specVersion: 1,
  name: "Riverside Salon",
  theme: { colors: { brand: "#1a7f5a" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
  content: [],
  pages: [],
});

/** A fetch that records what it was asked and answers with what it was given. */
function stub(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const headersOf = (init: RequestInit) => (init.headers ?? {}) as Record<string, string>;

describe("the client", () => {
  it("sends the session as a bearer token", async () => {
    const { fetch, calls } = stub(200, { site: null, counts: {}, lastChange: null });
    await new Client({ url: "http://localhost:8812", token: "t0ken", fetch }).status();

    expect(calls[0]!.url).toBe("http://localhost:8812/api/status");
    expect(headersOf(calls[0]!.init)["authorization"]).toBe("Bearer t0ken");
  });

  it("sends no authorization header when there is no token", async () => {
    const { fetch, calls } = stub(200, { token: "x", expiresAt: "", owner: { email: "a@b.c" } });
    await new Client({ url: "http://localhost:8812", fetch }).login("a@b.c", "pw");

    expect(headersOf(calls[0]!.init)["authorization"]).toBeUndefined();
  });

  it("does not double the slash between base and path", async () => {
    const { fetch, calls } = stub(200, { spec });
    // A trailing slash is what someone pastes from a browser.
    await new Client({ url: "http://localhost:8812/", fetch }).spec();
    expect(calls[0]!.url).toBe("http://localhost:8812/api/spec");
  });

  it("keeps 409 distinguishable, because the caller can resolve it", async () => {
    const { fetch } = stub(409, { message: "refusing 1 destructive change(s)" });
    const client = new Client({ url: "http://x", token: "t", fetch });

    const error = await client.apply(spec).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).needsConfirmation).toBe(true);
    expect((error as ApiError).unauthorized).toBe(false);
    // The server's own words, not a generic failure.
    expect((error as ApiError).message).toMatch(/destructive/);
  });

  it("keeps 401 distinguishable, because the caller must sign in", async () => {
    const { fetch } = stub(401, { message: "Sign in to continue." });
    const error = await new Client({ url: "http://x", fetch }).status().catch((e: unknown) => e);
    expect((error as ApiError).unauthorized).toBe(true);
  });

  it("carries the validation issues a bad spec came back with", async () => {
    const { fetch } = stub(400, {
      message: "That is not a valid spec.",
      issues: [{ path: "/content/0/key", message: "Required" }],
    });
    const error = await new Client({ url: "http://x", token: "t", fetch })
      .plan(spec)
      .catch((e: unknown) => e);

    expect((error as ApiError).issues).toEqual([{ path: "/content/0/key", message: "Required" }]);
  });

  it("asks for confirmation explicitly rather than by omission", async () => {
    const { fetch, calls } = stub(200, { seq: 2, changes: [], migration: [] });
    await new Client({ url: "http://x", token: "t", fetch }).apply(spec, {
      allowDestructive: true,
    });

    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ allowDestructive: true });
  });
});
