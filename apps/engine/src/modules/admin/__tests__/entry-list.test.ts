/**
 * What the entries page is told (ADR 0037, ADR 0051).
 *
 * The page draws strings; every judgement about what a cell says, which
 * column earns a place beside the name, and who sees the publish buttons is
 * made here — so it is tested here, without a browser.
 */
import { describe, expect, it } from "vitest";
import { SiteSpec, type ContentType } from "@forinda-cms/spec";
import type { EntryRow } from "@forinda-cms/db";

import { entryList } from "../utils/entries.view";

const spec = SiteSpec.parse({
  specVersion: 2,
  name: "Riverside Salon",
  theme: { colors: { brand: "#1a7f5a" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
  content: [
    {
      key: "booking",
      label: "Booking",
      labelPlural: "Bookings",
      fields: [
        { name: "name", label: "Name", type: "text" },
        { name: "notes", label: "Notes", type: "text" },
        { name: "when", label: "When", type: "datetime" },
      ],
    },
    {
      key: "service",
      label: "Service",
      fields: [{ name: "name", label: "Name", type: "text" }],
    },
  ],
  pages: [],
});

const booking = spec.content[0] as ContentType;
const service = spec.content[1] as ContentType;

const row = (data: Record<string, unknown>, over: Partial<EntryRow> = {}): EntryRow =>
  ({ id: "e1", slug: "cut", status: "draft", data, ...over }) as EntryRow;

const props = (over: Partial<Parameters<typeof entryList>[0]> = {}) =>
  entryList({
    type: booking,
    rows: [],
    total: 0,
    page: 1,
    perPage: 25,
    search: "",
    status: "",
    sort: "newest",
    canWrite: true,
    ...over,
  });

describe("the entries page's props", () => {
  it("puts the date beside the name, not the first field that is not the name", () => {
    const { secondLabel, rows } = props({
      rows: [row({ name: "Amina", notes: "fringe", when: "2026-10-20T09:30:00.000Z" })],
      total: 1,
    });
    expect(secondLabel).toBe("When");
    expect(rows[0]).toMatchObject({ title: "Amina", second: "2026-10-20 09:30" });
  });

  it("offers no second column when the type has nothing worth one", () => {
    const { secondLabel, rows } = props({ type: service, rows: [row({ name: "Cut" })], total: 1 });
    expect(secondLabel).toBeNull();
    expect(rows[0]?.second).toBeNull();
  });

  it("names a row with a dash rather than nothing", () => {
    expect(props({ rows: [row({})], total: 1 }).rows[0]?.title).toBe("—");
  });

  it("counts pages from the whole result, not the rows on this one", () => {
    expect(props({ total: 51 }).pages).toBe(3);
    expect(props({ total: 0 }).pages).toBe(1);
  });

  it("hides the publish buttons from somebody who cannot press them", () => {
    expect(props({ canWrite: false }).canWrite).toBe(false);
  });

  it("hides them on a computed type, whatever the role", () => {
    const derived = { ...service, derived: { from: "service" } } as unknown as ContentType;
    expect(props({ type: derived, canWrite: true }).canWrite).toBe(false);
  });

  it("hands the filters back as asked, so the page can draw them", () => {
    expect(props({ search: "amina", status: "draft", sort: "title" }).filters).toEqual({
      q: "amina",
      status: "draft",
      sort: "title",
    });
  });
});
