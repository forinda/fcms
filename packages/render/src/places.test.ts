/**
 * Places (ADR 0026).
 *
 * The distance is the part worth pinning: it is what a listing sorts by, and
 * "nearest first" being subtly wrong is the kind of bug nobody reports because
 * nobody can see it from one screen.
 */
import { describe, expect, it } from "vitest";
import { SiteSpec } from "@forinda-cms/spec";

import { staticSource, withDerived } from "./entries.js";
import { renderPage } from "./render.js";
import { addDistance, distanceKm, parsePoint, pointOf } from "./places.js";

const NAIROBI = { lat: -1.2921, lng: 36.8219 };
const NAIVASHA = { lat: -0.7167, lng: 36.4333 };

describe("coordinates", () => {
  it("reads a stored point, and refuses what is not one", () => {
    expect(pointOf({ lat: 1, lng: 2 })).toEqual({ lat: 1, lng: 2 });
    expect(pointOf({ lat: "1", lng: 2 })).toBeNull();
    expect(pointOf({ lat: 91, lng: 2 })).toBeNull();
    expect(pointOf(null)).toBeNull();
    expect(pointOf("1,2")).toBeNull();
  });

  it("reads the pair a visitor pastes, and refuses the rest", () => {
    expect(parsePoint("-1.2921,36.8219")).toEqual(NAIROBI);
    expect(parsePoint(" -1.2921 , 36.8219 ")).toEqual(NAIROBI);
    expect(parsePoint("-1.2921")).toBeNull();
    expect(parsePoint("-1.2921,36.8219,17")).toBeNull();
    expect(parsePoint("here")).toBeNull();
    // Out of range, which is what a swapped pair usually looks like: a
    // latitude of 91 does not exist.
    expect(parsePoint("91,36.8219")).toBeNull();
    expect(parsePoint("-1.2921,181")).toBeNull();
  });
});

describe("distance", () => {
  it("measures a known pair", () => {
    // Nairobi to Naivasha, as the crow flies. (The road is about 90.)
    expect(distanceKm(NAIROBI, NAIVASHA)).toBe(77.2);
  });

  it("is zero for the same place and symmetric between two", () => {
    expect(distanceKm(NAIROBI, NAIROBI)).toBe(0);
    expect(distanceKm(NAIROBI, NAIVASHA)).toBe(distanceKm(NAIVASHA, NAIROBI));
  });

  it("crosses the antimeridian without going the long way round", () => {
    // 1° apart across the date line, not 359°.
    expect(distanceKm({ lat: 0, lng: 179.5 }, { lat: 0, lng: -179.5 })).toBeCloseTo(111, 0);
  });
});

describe("adding it to rows", () => {
  const type = {
    key: "room",
    label: "Room",
    fields: [
      { name: "name", label: "Name", type: "text" as const },
      { name: "location", label: "Where", type: "geo" as const },
    ],
  } as never;

  const rows = [
    { id: "1", name: "Town", location: NAIROBI },
    { id: "2", name: "Lake", location: NAIVASHA },
    { id: "3", name: "Unknown" },
  ];

  it("adds nothing until the visitor says where they are", () => {
    // A stored distance is a distance from somewhere nobody asked about.
    expect(addDistance(type, rows, {})).toBe(rows);
  });

  it("measures each row from the parameter", () => {
    const measured = addDistance(type, rows, { near: "-1.2921,36.8219" });
    expect(measured[0]!["distanceKm"]).toBe(0);
    expect(measured[1]!["distanceKm"]).toBe(77.2);
  });

  it("leaves a row with no coordinate without a distance, not at zero", () => {
    // Zero would sort it to the top of "nearest first".
    const measured = addDistance(type, rows, { near: "-1.2921,36.8219" });
    expect(measured[2]!["distanceKm"]).toBeNull();
  });
});

const spec = SiteSpec.parse({
  specVersion: 2,
  name: "Riverside Rooms",
  theme: { colors: { brand: "#1d4ed8" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
  content: [
    {
      key: "room",
      label: "Room",
      titleField: "name",
      fields: [
        { name: "name", label: "Name", type: "text" },
        { name: "location", label: "Where", type: "geo" },
      ],
    },
  ],
  pages: [
    {
      key: "rooms",
      path: "/rooms",
      title: "Rooms",
      blocks: [
        {
          type: "list",
          data: {
            from: "room",
            sort: { param: "sort", allow: ["distanceKm"], default: "distanceKm" },
            limit: 10,
          },
          item: [
            {
              type: "card",
              attrs: { heading: "{{ item.name }}", meta: "{{ item.distanceKm }} km" },
            },
          ],
        },
      ],
    },
    {
      key: "room",
      path: "/room",
      title: "Room",
      collection: { from: "room" },
      blocks: [{ type: "map", attrs: { at: "location", zoom: 14 } }],
    },
  ],
});

const source = staticSource({
  room: [
    { id: "1", slug: "lake", name: "Lake house", location: NAIVASHA },
    { id: "2", slug: "town", name: "Town flat", location: NAIROBI },
  ],
});

describe("on a page", () => {
  it("sorts a listing by how near it is", () => {
    const { html } = renderPage(spec.pages[0]!, {
      spec,
      source: withDerived(spec, source, new Date(), { near: "-1.2921,36.8219" }),
      params: { near: "-1.2921,36.8219" },
    });

    // Nairobi first, then Naivasha 77.2 km away.
    expect(html.indexOf("Town flat")).toBeLessThan(html.indexOf("Lake house"));
    expect(html).toContain("77.2 km");
  });

  it("puts a row with no coordinate last, not first", () => {
    // `null` sorting as zero would put every address-less row at the top of
    // "nearest first", which is the one place it must never be.
    const withUnlocated = staticSource({
      room: [
        { id: "1", slug: "lake", name: "Lake house", location: NAIVASHA },
        { id: "3", slug: "nowhere", name: "No address" },
        { id: "2", slug: "town", name: "Town flat", location: NAIROBI },
      ],
    });

    const { html } = renderPage(spec.pages[0]!, {
      spec,
      source: withDerived(spec, withUnlocated, new Date(), { near: "-1.2921,36.8219" }),
      params: { near: "-1.2921,36.8219" },
    });

    expect(html.indexOf("Town flat")).toBeLessThan(html.indexOf("Lake house"));
    expect(html.indexOf("Lake house")).toBeLessThan(html.indexOf("No address"));
  });

  it("renders a map with no key, no script and no tracker", () => {
    const entry = source.all("room")[0]!;
    const { html } = renderPage(spec.pages[1]!, { spec, source }, entry as never);

    expect(html).toContain("openstreetmap.org/export/embed.html");
    expect(html).toContain("marker=-0.7167,36.4333");
    expect(html).toContain('referrerpolicy="no-referrer"');
    // The whole point of choosing the embed: nothing to load, nobody to pay.
    expect(html).not.toContain("<script");
    expect(html).not.toContain("api_key");
  });

  it("renders nothing at all when the row has no coordinate", () => {
    const { html } = renderPage(spec.pages[1]!, { spec, source }, {
      id: "3",
      slug: "x",
      name: "No address",
    } as never);
    expect(html).not.toContain("openstreetmap");
  });
});
