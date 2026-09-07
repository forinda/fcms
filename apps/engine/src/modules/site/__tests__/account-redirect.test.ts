/**
 * Where an account form sends you afterwards.
 *
 * A form that sets a session cookie *and* redirects wherever it is told is a
 * phishing primitive: a link that signs someone in and lands them on a page
 * that looks like the site. So the destination is checked, and these are the
 * shapes that must not get through.
 */
import { describe, expect, it } from "vitest";

/**
 * The rule the controller applies, isolated.
 *
 * Kept identical to the source deliberately — the guard is three characters of
 * regex, and the value of the test is that the *cases* are written down.
 */
const safe = (asked: string): string => (/^\/(?!\/)[^\s]*$/.test(asked) ? asked : "/");

describe("returning to where they were", () => {
  it("keeps a path on this site", () => {
    expect(safe("/find")).toBe("/find");
    expect(safe("/hotels/grand?nights=3")).toBe("/hotels/grand?nights=3");
  });

  it("refuses another origin", () => {
    expect(safe("https://evil.example/x")).toBe("/");
    expect(safe("http://evil.example")).toBe("/");
  });

  it("refuses a protocol-relative URL, which is another origin in disguise", () => {
    // `//evil.example` is not a path; browsers read it as a host.
    expect(safe("//evil.example")).toBe("/");
  });

  it("refuses a scheme that runs something", () => {
    expect(safe("javascript:alert(1)")).toBe("/");
    expect(safe("data:text/html,<script>")).toBe("/");
  });

  it("refuses whitespace, which some parsers strip before following", () => {
    expect(safe("/ok\n//evil.example")).toBe("/");
    expect(safe(" //evil.example")).toBe("/");
  });
});
