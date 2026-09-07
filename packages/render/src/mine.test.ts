/**
 * A visitor's own rows (ADR 0027).
 *
 * Every case here is a leak that would be invisible from one screen: another
 * guest's booking in your list, your draft in a public count, or the whole
 * table for anybody who signs in.
 */
import { describe, expect, it } from "vitest";
import { SiteSpec } from "@forinda-cms/spec";

import {
  DRAFT_KEY,
  VISITOR_KEY,
  runQueryExcluding,
  runQueryPage,
  staticSource,
} from "./entries.js";
import { renderPage } from "./render.js";

const ANA = "11111111-1111-7111-8111-111111111111";
const BEN = "22222222-2222-7222-8222-222222222222";

const rows = [
  { id: "1", reference: "BK-1", [VISITOR_KEY]: ANA, [DRAFT_KEY]: true },
  { id: "2", reference: "BK-2", [VISITOR_KEY]: BEN, [DRAFT_KEY]: true },
  { id: "3", reference: "BK-3", [VISITOR_KEY]: ANA, [DRAFT_KEY]: false },
  { id: "4", reference: "BK-4", [DRAFT_KEY]: false },
];

const source = staticSource({ booking: rows });
const all = { from: "booking", limit: 20 } as never;
const mine = { from: "booking", mine: true, limit: 20 } as never;

const refs = (result: { rows: readonly Record<string, unknown>[] }) =>
  result.rows.map((row) => row["reference"]);

describe("a query for your own rows", () => {
  it("returns the signed-in visitor's rows, drafts included", () => {
    // The whole point: a submission lands as a draft, so without this the
    // person who booked cannot see what they booked.
    expect(refs(runQueryPage(source, mine, {}, ANA))).toEqual(["BK-1", "BK-3"]);
  });

  it("never returns another visitor's rows", () => {
    expect(refs(runQueryPage(source, mine, {}, BEN))).toEqual(["BK-2"]);
  });

  it("returns nothing when nobody is signed in", () => {
    // Not everything, and not an error.
    expect(refs(runQueryPage(source, mine, {}, null))).toEqual([]);
    expect(refs(runQueryPage(source, mine, {}, undefined))).toEqual([]);
  });

  it("cannot be aimed at somebody else by a request parameter", () => {
    // There is no parameter that names whose rows to return — the only input
    // is the viewer the server resolved from the cookie.
    expect(refs(runQueryPage(source, mine, { visitor: BEN, mine: "true" }, ANA))).toEqual([
      "BK-1",
      "BK-3",
    ]);
  });
});

describe("a query that did not ask", () => {
  it("shows published rows only, even to the author", () => {
    // A page that forgets `mine` cannot list drafts: the filter is on by
    // default and lifted only for rows that pass both checks.
    expect(refs(runQueryPage(source, all, {}, ANA))).toEqual(["BK-3", "BK-4"]);
    expect(refs(runQueryPage(source, all, {}, null))).toEqual(["BK-3", "BK-4"]);
  });

  it("counts only published rows in a total", () => {
    expect(runQueryPage(source, all, {}, ANA).total).toBe(2);
  });

  it("keeps drafts out of facet counts", () => {
    // A visitor's own draft is not part of what anybody else is choosing from.
    const counted = runQueryExcluding(source, all, {}, "none");
    expect(counted.map((row) => row["reference"])).toEqual(["BK-3", "BK-4"]);
  });
});

describe("on a page", () => {
  const spec = SiteSpec.parse({
    specVersion: 2,
    name: "Riverside Rooms",
    theme: { colors: { brand: "#1d4ed8" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
    content: [
      {
        key: "booking",
        label: "Booking",
        submissions: "visitors",
        fields: [{ name: "reference", label: "Reference", type: "text" }],
      },
    ],
    pages: [
      {
        key: "stays",
        path: "/account",
        title: "Your stays",
        blocks: [
          {
            type: "list",
            data: { from: "booking", mine: true, limit: 20 },
            item: [{ type: "card", attrs: { heading: "{{ item.reference }}" } }],
          },
        ],
      },
    ],
  });

  it("shows a guest their own booking and nobody else's", () => {
    const { html } = renderPage(spec.pages[0]!, { spec, source, viewer: ANA });
    expect(html).toContain("BK-1");
    expect(html).not.toContain("BK-2");
  });

  it("shows a signed-out visitor nothing, on the same public page", () => {
    const { html } = renderPage(spec.pages[0]!, { spec, source });
    for (const reference of ["BK-1", "BK-2", "BK-3", "BK-4"]) {
      expect(html).not.toContain(reference);
    }
  });

  it("never renders the markers themselves", () => {
    const { html } = renderPage(spec.pages[0]!, { spec, source, viewer: ANA });
    expect(html).not.toContain("_visitor");
    expect(html).not.toContain("_draft");
  });
});
