/**
 * The controls an entry form generates (ADR 0038).
 *
 * A `reference` is stored as `ref:type/slug` and an `asset` as `asset:id`.
 * Rendered as text boxes, an owner had to type an identifier by hand — which is
 * not editing, it is transcription, and a typo saves a reference that resolves
 * to nothing.
 */
import { describe, expect, it } from "vitest";
import { ContentType } from "@forinda-cms/spec";

import { entryForm, fieldInput, type FieldChoices } from "../utils/view";

const type = ContentType.parse({
  key: "booking",
  label: "Booking",
  titleField: "customerName",
  fields: [
    { name: "customerName", label: "Customer name", type: "text", required: true },
    { name: "service", label: "Service", type: "reference", to: "service", required: true },
    { name: "photo", label: "Photo", type: "asset" },
    { name: "where", label: "Where", type: "geo" },
  ],
});

const field = (name: string) => type.fields.find((f) => f.name === name)!;

const choices: FieldChoices = {
  references: {
    service: [
      { value: "ref:service/cut", label: "Cut and finish" },
      { value: "ref:service/braids", label: "Braids" },
    ],
  },
  assets: [{ value: "asset:abc", label: "Front of the salon", image: true, id: "abc" }],
};

describe("a reference", () => {
  it("is chosen from the rows that exist", () => {
    const html = fieldInput(field("service"), "ref:service/braids", undefined, choices);
    expect(html).toContain("<select");
    expect(html).toContain('value="ref:service/cut"');
    expect(html).toContain('value="ref:service/braids" selected');
    expect(html).toContain("Cut and finish");
  });

  it("says so when there is nothing to point at, rather than offering a box", () => {
    const html = fieldInput(field("service"), "", undefined, { references: { service: [] } });
    expect(html).toContain("no service entries to point at yet");
    // The value it already had is kept, so opening a form cannot erase it.
    expect(html).toContain('type="hidden"');
  });
});

describe("an asset", () => {
  it("is chosen from the library, and shows what is chosen", () => {
    const html = fieldInput(field("photo"), "asset:abc", undefined, choices);
    expect(html).toContain('value="asset:abc" selected');
    expect(html).toContain('src="/media/abc"');
    expect(html).toContain("/admin/media");
  });

  it("keeps an existing value when the library is empty", () => {
    const html = fieldInput(field("photo"), "asset:gone", undefined, { assets: [] });
    expect(html).toContain('value="asset:gone"');
    expect(html).toContain('type="hidden"');
  });
});

describe("a coordinate", () => {
  it("is one box, holding what a map gives you", () => {
    const html = fieldInput(field("where"), { lat: -1.2921, lng: 36.8219 });
    expect(html).toContain('value="-1.2921, 36.8219"');
  });
});

describe("the form as a whole", () => {
  it("passes the choices to every field that needs them", () => {
    const html = entryForm(
      type,
      { service: "ref:service/cut" },
      {
        action: "/admin/content/booking/new",
        choices,
      },
    );

    expect(html).toContain('value="ref:service/cut" selected');
    expect(html).toContain('name="photo"');
    // Text fields are untouched by any of this.
    expect(html).toContain('id="f-customerName"');
  });
});
