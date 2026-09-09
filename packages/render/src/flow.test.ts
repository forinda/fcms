/**
 * A step that filters and then chooses.
 *
 * Picking dates and then picking from what those dates leave free is the shape
 * every booking journey has, and it could not be written: a step is answered by
 * choosing a row, so dates cannot be a step of their own — and putting the
 * filter in the choosing step nested one form inside another, which is markup a
 * browser does not keep.
 */
import { describe, expect, it } from "vitest";
import { SiteSpec } from "@forinda-cms/spec";

import { renderPage } from "./render.js";
import { staticSource } from "./entries.js";

const spec = SiteSpec.parse({
  specVersion: 2,
  name: "Stays",
  theme: { colors: { brand: "#003580" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
  content: [
    {
      key: "room",
      label: "Room",
      titleField: "name",
      fields: [
        { name: "name", label: "Name", type: "text", required: true },
        { name: "sleeps", label: "Sleeps", type: "number", filterable: true },
      ],
    },
    {
      key: "booking",
      label: "Booking",
      titleField: "reference",
      fields: [
        { name: "reference", label: "Reference", type: "text", required: true },
        { name: "room", label: "Room", type: "reference", to: "room" },
      ],
    },
  ],
  pages: [
    {
      key: "book",
      path: "/book",
      title: "Book",
      flows: [
        {
          key: "stay",
          steps: [
            {
              key: "room",
              label: "Which room",
              selects: { from: "room", as: "room" },
              blocks: [
                { type: "filters", attrs: { for: "room", submit: "Search" } },
                {
                  type: "results-count",
                  attrs: {
                    for: "room",
                    one: "{{ results.total }} room",
                    many: "{{ results.total }} rooms",
                  },
                },
                {
                  type: "list",
                  data: {
                    from: "room",
                    where: [{ field: "sleeps", op: "gte", value: { param: "sleeps" } }],
                    limit: 10,
                  },
                  item: [{ type: "card", attrs: { heading: "{{ item.name }}" } }],
                },
              ],
            },
            {
              key: "details",
              label: "Your details",
              requires: ["room"],
              blocks: [{ type: "form", attrs: { for: "booking", submitLabel: "Reserve" } }],
            },
          ],
        },
      ],
      blocks: [{ type: "heading", attrs: { text: "Book", level: 1 } }],
    },
  ],
});

const source = staticSource({
  room: [
    { id: "r1", slug: "single", name: "Single", sleeps: 1 },
    { id: "r2", slug: "double", name: "Double", sleeps: 2 },
    { id: "r3", slug: "family", name: "Family", sleeps: 4 },
  ],
  booking: [],
});

const render = (params: Record<string, string> = {}) =>
  renderPage(spec.pages[0]!, { spec, source, params }).html;

/** Every `<form>`, in order, with the depth it was opened at. */
function formDepths(html: string): number[] {
  const depths: number[] = [];
  let depth = 0;
  for (const match of html.matchAll(/<form|<\/form>/g)) {
    if (match[0] === "<form") depths.push(++depth);
    else depth -= 1;
  }
  return depths;
}

describe("a step that filters and chooses", () => {
  it("never puts one form inside another", () => {
    // A browser closes the outer form at the inner one, and whichever of the
    // two the author needed stops working. This was depth 2.
    expect(Math.max(...formDepths(render()))).toBe(1);
  });

  it("keeps the filter above the rooms it filters", () => {
    const html = render();
    expect(html.indexOf("fx-filters")).toBeLessThan(html.indexOf("fx-flow-choose"));
  });

  it("still posts the choice to the step", () => {
    expect(render()).toContain('action="/flow/book/stay/room"');
    expect(render()).toContain('name="choice" value="double"');
  });

  it("counts what the step found", () => {
    // `results` is bound from the step's own query. Without it this read
    // " rooms" — the sentence with the number missing.
    expect(render()).toContain("3 rooms");
    expect(render({ sleeps: "2" })).toContain("2 rooms");
  });
});
