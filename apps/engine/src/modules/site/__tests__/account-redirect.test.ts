/**
 * Where an account form sends you afterwards.
 *
 * A form that sets a session cookie *and* redirects wherever it is told is a
 * phishing primitive: a link that signs someone in and lands them on a page
 * that looks like the site. So the destination is checked, and these are the
 * shapes that must not get through.
 */
import { describe, expect, it } from "vitest";

// The rule both forms apply — imported, not copied. The copy that used to
// live here passed every case below while the source let `/\evil` through.
import { sameSitePath as safe } from "../same-site-path";

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

  it("refuses a backslash, which browsers read as a slash", () => {
    // `/\evil.example` is `//evil.example` to a browser: another origin.
    expect(safe("/\\evil.example")).toBe("/");
    expect(safe("/\\/evil.example")).toBe("/");
    expect(safe("/\\\\evil.example")).toBe("/");
  });

  it("refuses a path that only becomes another origin once it is resolved", () => {
    // Dot-segments collapse to `//evil.example`: the same origin while being
    // parsed, another host once a browser reads it as a Location.
    expect(safe("/.//evil.example")).toBe("/");
    expect(safe("/a/..//evil.example")).toBe("/");
    expect(safe("/./\\evil.example")).toBe("/");
  });

  it("returns the parsed path, not the text it was asked for", () => {
    expect(safe("/a/../find?x=1#top")).toBe("/find?x=1#top");
    expect(safe(undefined)).toBe("/");
  });

  it("refuses whitespace, which some parsers strip before following", () => {
    expect(safe("/ok\n//evil.example")).toBe("/");
    expect(safe(" //evil.example")).toBe("/");
  });
});
