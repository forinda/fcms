/**
 * Richtext is HTML, and HTML can carry a script.
 *
 * The block used to pass its `html` through untouched, on the assumption that
 * only the owner writes it. It is bound from entry data too, and entries
 * include what visitors submit — a richtext `message` on the enquiry starter,
 * say — and the admin previews drafts inside the owner's session. So a
 * visitor's markup ran with the owner's cookie. These are the shapes that
 * must not survive, and the formatting that must.
 */
import { describe, expect, it } from "vitest";

import { CORE_BLOCKS } from "./blocks.js";
import { raw, render } from "./html.js";

const richtext = (html: string) =>
  render(
    CORE_BLOCKS["richtext"]!.render({
      className: "fx-richtext",
      attrs: { html },
      children: raw(""),
      hasChildren: false,
      scope: {} as never,
    }),
  );

describe("richtext", () => {
  it.each([
    ["a script element", "<script>alert(1)</script>"],
    ["an event handler", '<img src="/media/x" onerror="alert(1)">'],
    ["a javascript: link", '<a href="javascript:alert(1)">x</a>'],
    ["an entity-hidden javascript: link", '<a href="jav&#x09;ascript:alert(1)">x</a>'],
    ["a data: URL that is a page", '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
    ["an svg with a handler", '<svg><a onload="alert(1)"></a></svg>'],
    ["an iframe", '<iframe src="https://evil.example"></iframe>'],
    ["inline style", '<p style="background:url(javascript:alert(1))">x</p>'],
    ["a form", '<form action="https://evil.example"><input name="password"></form>'],
  ])("drops %s", (_, html) => {
    // Read the way a browser reads it: entities decoded, and the tabs and
    // control characters it ignores inside a scheme removed.
    const out = richtext(html)
      .replace(/&#(x?)([0-9a-f]+);?/gi, (_m, hex: string, n: string) =>
        String.fromCodePoint(Number.parseInt(n, hex ? 16 : 10)),
      )
      // oxlint-disable-next-line no-control-regex -- matching them is the point: a browser drops them inside a scheme
      .replace(/[\s\u0000-\u001f]/g, "")
      .toLowerCase();
    expect(out).not.toMatch(
      /<script|onerror|onload|javascript:|data:text|<iframe|style=|<form|<svg/,
    );
  });

  it("keeps the formatting an owner writes", () => {
    const html =
      "<h2>Hours</h2><p>Open <strong>daily</strong>, <em>except</em> Sunday.</p>" +
      "<ul><li>Cuts</li><li>Colour</li></ul>" +
      '<p><a href="https://maps.example/salon">Find us</a> or <a href="mailto:hi@salon.test">write</a>.</p>' +
      '<img src="/media/abc" alt="The shop">';
    const out = richtext(html);
    for (const kept of [
      "<h2>Hours</h2>",
      "<strong>daily</strong>",
      "<em>except</em>",
      "<li>Cuts</li>",
      'href="https://maps.example/salon"',
      'href="mailto:hi@salon.test"',
      'src="/media/abc"',
      'alt="The shop"',
    ])
      expect(out).toContain(kept);
  });
});
