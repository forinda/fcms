/**
 * A rejected write has to say which field.
 *
 * This was thrown as an `HttpException` with the field errors in `details`, and
 * the framework's error handler exposes `details` only when `NODE_ENV` is not
 * `production` — which the published server always sets. So every self-hosted
 * install answered a rejected write with a sentence and nothing else, and
 * `fcms apply --content` refused twelve rows without naming one field.
 *
 * A response is not an error, so nothing strips it. The test is written against
 * the shape a client reads rather than against the return type, because the
 * return type was never the problem.
 */
import { describe, expect, it } from "vitest";

import { invalidEntry } from "../api.controller";

describe("a rejected write", () => {
  it("names every field that failed", () => {
    const body = invalidEntry({
      name: "This is required.",
      stars: "Must be at most 5.",
    }).body as { status: number; errors: { path: string; message: string }[] };

    expect(body.status).toBe(422);
    expect(body.errors).toEqual([
      { path: "name", message: "This is required." },
      { path: "stars", message: "Must be at most 5." },
    ]);
  });

  it("is a response and not an exception, which is the whole point", () => {
    // Thrown, the errors are stripped in production and the caller is told only
    // that something is wrong. Returned, they survive.
    const result = invalidEntry({ name: "This is required." });
    expect(result).not.toBeInstanceOf(Error);
    expect(result.status).toBe(422);
  });
});
