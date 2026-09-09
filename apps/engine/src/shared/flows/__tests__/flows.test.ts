/**
 * Journeys (ADR 0028).
 *
 * The properties worth pinning are the ones a request could otherwise assert:
 * a choice that was never offered, a selection changed on the way to the form,
 * and somebody else's journey read with a guessed token.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeAllPools, createDb, flowSessions, organizations, sites } from "@forinda-cms/db";
import { SiteSpec } from "@forinda-cms/spec";

import { FlowUseCase } from "../flow.usecase";

const url = process.env["DATABASE_URL"];
const suite = url ? describe : describe.skip;
const db = url ? createDb(url) : (undefined as never);

const ORG = "org_flows";
const SITE = "site_flows";

const spec = SiteSpec.parse({
  specVersion: 2,
  name: "Riverside Salon",
  theme: { colors: { brand: "#1a7f5a" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
  content: [
    { key: "staff", label: "Stylist", fields: [{ name: "name", label: "Name", type: "text" }] },
    {
      key: "booking",
      label: "Booking",
      submissions: "anyone",
      fields: [
        { name: "stylist", label: "Stylist", type: "reference", to: "staff" },
        { name: "startsAt", label: "Starts at", type: "datetime" },
      ],
    },
  ],
  pages: [
    {
      key: "book",
      path: "/book",
      title: "Book",
      blocks: [{ type: "heading", attrs: { text: "Book" } }],
      flows: [
        {
          key: "booking",
          steps: [
            {
              key: "stylist",
              selects: { from: "staff", as: "stylist" },
              blocks: [
                { type: "list", data: { from: "staff", limit: 8 }, item: [{ type: "card" }] },
              ],
            },
            {
              key: "slot",
              requires: ["stylist"],
              selects: { from: "availability", as: "startsAt" },
              blocks: [{ type: "text", attrs: { text: "when" } }],
            },
            {
              key: "details",
              requires: ["slot"],
              blocks: [{ type: "form", attrs: { for: "booking" } }],
            },
          ],
          onComplete: [{ action: "entry.transition", params: { to: "confirmed" } }],
        },
      ],
    },
  ],
});

const page = spec.pages[0]!;
const flow = page.flows![0]!;

suite("flows", () => {
  let flows: FlowUseCase;
  const token = "a".repeat(64);
  const other = "b".repeat(64);

  beforeEach(async () => {
    await db.delete(flowSessions);
    await db.delete(sites).where(eq(sites.orgId, ORG));
    await db.delete(organizations).where(eq(organizations.id, ORG));
    await db.insert(organizations).values({ id: ORG, name: "Flows org" });
    await db.insert(sites).values({ id: SITE, orgId: ORG, slug: "salon", name: "Salon" });

    flows = new FlowUseCase(db, { orgId: ORG, siteId: SITE });
  });

  afterAll(async () => {
    if (url) await closeAllPools();
  });

  it("remembers what was chosen, and hands it back for the renderer's scope", async () => {
    await flows.choose(token, page, flow, "stylist", { slug: "amina", name: "Amina" });

    expect(await flows.answers(token, page.key, flow.key)).toEqual({
      stylist: { slug: "amina", name: "Amina" },
    });
  });

  it("keeps one journey out of another's", async () => {
    // The token is the only key, so a guessed one must find nothing.
    await flows.choose(token, page, flow, "stylist", { slug: "amina" });
    expect(await flows.answers(other, page.key, flow.key)).toEqual({});
    expect(await flows.answers(undefined, page.key, flow.key)).toEqual({});
  });

  it("stores the token hashed, never the token", async () => {
    await flows.choose(token, page, flow, "stylist", { slug: "amina" });
    const [row] = await db.select().from(flowSessions);

    expect(row!.tokenHash).not.toBe(token);
    expect(row!.tokenHash).toHaveLength(64);
  });

  it("forgets a step and everything that depended on it", async () => {
    await flows.choose(token, page, flow, "stylist", { slug: "amina" });
    await flows.choose(token, page, flow, "slot", { startsAt: "2026-10-01T09:00:00Z" });

    // Changing the stylist un-answers the slot: a time chosen for somebody
    // who is no longer the stylist is an answer to a question that is gone.
    await flows.forget(token, page, flow, "stylist");
    expect(await flows.answers(token, page.key, flow.key)).toEqual({});
  });

  it("deletes its own state when the journey completes", async () => {
    await flows.choose(token, page, flow, "stylist", { slug: "amina" });
    await flows.finish(token, page.key, flow.key);

    expect(await db.select().from(flowSessions)).toHaveLength(0);
  });

  it("treats an expired journey as one that was never started", async () => {
    await flows.choose(token, page, flow, "stylist", { slug: "amina" });
    await db.update(flowSessions).set({ expiresAt: new Date(Date.now() - 1000) });

    expect(await flows.answers(token, page.key, flow.key)).toEqual({});
  });
});

describe("what a selection fills", () => {
  it("names the row for a reference field, and takes the value otherwise", () => {
    const fields = FlowUseCase.fieldsFrom(spec, flow, "booking", {
      stylist: { slug: "amina", name: "Amina" },
      slot: { id: "amina:2026-10-01T09:00:00Z", startsAt: "2026-10-01T09:00:00Z" },
    });

    expect(fields).toEqual({
      stylist: "ref:staff/amina",
      startsAt: "2026-10-01T09:00:00Z",
    });
  });

  it("fills nothing for a selection the type has no field for", () => {
    const fields = FlowUseCase.fieldsFrom(spec, flow, "staff", {
      stylist: { slug: "amina" },
    });
    expect(fields).toEqual({});
  });
});

/**
 * A reference names the type the field declares.
 *
 * A step that chooses from a *derived* type — the rooms free for these dates —
 * wrote `ref:vacancy/…` into a field declared `to: room`. That is a reference
 * to a type which holds no rows. It resolved anyway, because matching compares
 * the slug, and it would stop the day a derived row's slug differed from the row
 * it was derived from.
 */
describe("choosing from a derived type", () => {
  const withVacancy = SiteSpec.parse({
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
          { name: "price", label: "Price", type: "number", required: true },
        ],
      },
      {
        key: "booking",
        label: "Booking",
        titleField: "reference",
        submissions: "anyone",
        fields: [
          { name: "reference", label: "Reference", type: "text", required: true },
          { name: "room", label: "Room", type: "reference", to: "room" },
          { name: "checkIn", label: "Check in", type: "date" },
          { name: "checkOut", label: "Check out", type: "date" },
        ],
      },
      {
        key: "vacancy",
        label: "Available room",
        derived: {
          kind: "stay",
          resource: { type: "room" },
          occupied: { type: "booking", resource: "room", from: "checkIn", to: "checkOut" },
          range: { from: "check-in", to: "check-out" },
          window: { days: 365 },
        },
        fields: [
          { name: "name", label: "Name", type: "text" },
          { name: "price", label: "Price", type: "number" },
        ],
      },
    ],
    pages: [
      {
        key: "book",
        path: "/book",
        title: "Book",
        blocks: [{ type: "heading", attrs: { text: "Book" } }],
        flows: [
          {
            key: "stay",
            steps: [
              {
                key: "room",
                selects: { from: "vacancy", as: "room" },
                blocks: [
                  { type: "list", data: { from: "vacancy", limit: 8 }, item: [{ type: "card" }] },
                ],
              },
              {
                key: "details",
                requires: ["room"],
                blocks: [{ type: "form", attrs: { for: "booking" } }],
              },
            ],
          },
        ],
      },
    ],
  });

  it("stores a reference to the type the field points at", () => {
    const fields = FlowUseCase.fieldsFrom(
      withVacancy,
      withVacancy.pages[0]!.flows![0]!,
      "booking",
      {
        room: { slug: "sea-view", name: "Sea view", price: 175 },
      },
    );

    // Not `ref:vacancy/sea-view`: `vacancy` is computed and holds no rows, so
    // nothing else in the system could ever resolve it.
    expect(fields).toEqual({ room: "ref:room/sea-view" });
  });
});
