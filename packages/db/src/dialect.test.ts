/**
 * The dialect seam (ADR 0049).
 *
 * Both dialects are checked against the same expectations, because the point of
 * the seam is that callers above `packages/db` cannot tell which one they have.
 * A helper that exists for only one of them is a helper the other will fail on,
 * at runtime, on somebody's install.
 */
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { dialectFor, postgres, sqlite, type Dialect } from "./dialect.js";

describe("dialectFor", () => {
  it("reads the dialect off the URL, so there is no second setting to get wrong", () => {
    expect(dialectFor("postgres://user:pass@localhost:5432/site").name).toBe("postgres");
    expect(dialectFor("postgresql://localhost/site").name).toBe("postgres");
    // Anything that is not a Postgres URL is a path to a file — which is the
    // default the install promise depends on (`npx forinda-cms`, no URL).
    expect(dialectFor("./forinda-cms.db").name).toBe("sqlite");
    expect(dialectFor("/var/lib/stays/site.db").name).toBe("sqlite");
    expect(dialectFor("").name).toBe("sqlite");
  });
});

describe.each([
  ["postgres", postgres],
  ["sqlite", sqlite],
] as const)("%s", (_name, dialect: Dialect) => {
  it("refuses a field name it would have to splice into a path", () => {
    // The name comes from a spec somebody wrote, so it is checked rather than
    // trusted — even though these build parameterised SQL, the path itself is
    // a string and a quote in it is a bug waiting for a bad day.
    for (const bad of ["a'b", "a.b", "a b", "", "1abc", "a-b"]) {
      expect(() => dialect.jsonText(sql`data`, bad)).toThrow(/unsafe field name/);
    }
    expect(() => dialect.jsonText(sql`data`, "priceFrom")).not.toThrow();
    expect(() => dialect.jsonText(sql`data`, "check_in")).not.toThrow();
  });

  it("has a numeric read distinct from the text one", () => {
    // Without it `10` sorts before `9`, which is the bug the cast exists for
    // rather than a nicety. The two must not compile to the same thing.
    const text = dialect.jsonText(sql`data`, "price");
    const number = dialect.jsonNumber(sql`data`, "price");
    expect(JSON.stringify(number)).not.toBe(JSON.stringify(text));
  });

  it("answers the questions a caller above the seam has to ask", () => {
    expect(dialect.now()).toBeDefined();
    expect(dialect.after(30)).toBeDefined();
    expect(dialect.jsonSet(sql`data`, "status", "confirmed")).toBeDefined();
    expect(dialect.likeInsensitive(sql`slug`, "%harbour%")).toBeDefined();
  });
});

describe("claiming", () => {
  it("locks on Postgres and does not on SQLite", () => {
    // Not an omission: SQLite has one writer, so a row cannot be claimed twice.
    // The ceiling is the concurrency model, and ADR 0049 asks for it to be
    // stated rather than papered over.
    expect(postgres.claimLock()).toBeDefined();
    expect(sqlite.claimLock()).toBeUndefined();
  });
});
