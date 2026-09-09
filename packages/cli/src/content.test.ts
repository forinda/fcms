/**
 * `--content` (ADR 0043).
 *
 * Two properties carry this: an export is a file somebody can commit, and an
 * import puts every row back where it came from. The tests use a fake site
 * rather than a database, because what can go wrong here is the *shape* — which
 * key means what, and which row is the same row as before.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SiteSpec } from "@forinda-cms/spec";
import type { Client, Entry, EntryInput } from "@forinda-cms/sdk";

import { pullContent, pushContent } from "./content.js";

const temps: string[] = [];
const dir = () => {
  const made = mkdtempSync(join(tmpdir(), "fcms-content-"));
  temps.push(made);
  return made;
};
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const spec = SiteSpec.parse({
  specVersion: 2,
  name: "Riverside Salon",
  theme: { colors: { brand: "#1a7f5a" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
  content: [
    {
      key: "service",
      label: "Service",
      titleField: "name",
      fields: [
        { name: "slug", label: "Slug", type: "text", required: true },
        { name: "name", label: "Name", type: "text", required: true },
      ],
    },
    {
      key: "booking",
      label: "Booking",
      titleField: "reference",
      fields: [
        { name: "reference", label: "Reference", type: "text" },
        {
          name: "status",
          label: "Status",
          type: "state",
          initial: "pending",
          values: ["pending", "confirmed"],
          transitions: [{ from: "pending", to: ["confirmed"] }],
        },
      ],
    },
  ],
  pages: [],
  logic: [],
});

const entry = (over: Partial<Entry>): Entry => ({
  id: "01a00000-0000-7000-8000-000000000001",
  slug: null,
  status: "published",
  data: {},
  updatedAt: "2026-09-08T00:00:00.000Z",
  ...over,
});

/** A site that remembers what it was told, and nothing else. */
function fakeSite(rows: Record<string, Entry[]>) {
  const created: { type: string; input: EntryInput }[] = [];
  const updated: { type: string; id: string; input: EntryInput }[] = [];

  const client = {
    entries: async (type: string) => rows[type] ?? [],
    createEntry: async (type: string, input: EntryInput) => {
      created.push({ type, input });
      return entry({ id: "new", ...input, slug: input.slug ?? null });
    },
    updateEntry: async (type: string, id: string, input: EntryInput) => {
      updated.push({ type, id, input });
      return entry({ id, ...input, slug: input.slug ?? null });
    },
  } as unknown as Client;

  return { client, created, updated };
}

describe("pulling content", () => {
  it("writes one file per stored type, in the shape the fixtures already use", async () => {
    const root = dir();
    const { client } = fakeSite({
      service: [
        entry({ id: "1", slug: "cut", data: { slug: "cut", name: "Cut" } }),
        entry({ id: "2", slug: "braids", data: { slug: "braids", name: "Braids" } }),
      ],
      booking: [],
    });

    expect(await pullContent(root, client, spec)).toBe(0);
    const text = readFileSync(join(root, "data", "service.yaml"), "utf8");

    // Sorted, so a second export of an unchanged site is byte-identical and
    // committing one produces no diff.
    expect(text.indexOf("braids")).toBeLessThan(text.indexOf("cut"));
    expect(text).not.toContain("__id");
    expect(text).not.toContain("__status");
  });

  it("keeps an id only for a row with no name of its own", async () => {
    const root = dir();
    const { client } = fakeSite({
      service: [],
      booking: [entry({ id: "abc", slug: null, status: "draft", data: { reference: "BK-1" } })],
    });

    await pullContent(root, client, spec);
    const text = readFileSync(join(root, "data", "booking.yaml"), "utf8");

    expect(text).toContain("__id: abc");
    expect(text).toContain("__status: draft");
  });

  it("prefixes the publish state, because a type may have a status of its own", async () => {
    const root = dir();
    const { client } = fakeSite({
      service: [],
      // A booking's own `status` is pending or confirmed. The entry's publish
      // state is draft or published. Written flat, one silently became the
      // other.
      booking: [entry({ id: "abc", status: "draft", data: { status: "confirmed" } })],
    });

    await pullContent(root, client, spec);
    const text = readFileSync(join(root, "data", "booking.yaml"), "utf8");

    expect(text).toContain("__status: draft");
    expect(text).toContain("status: confirmed");
  });
});

describe("pushing content", () => {
  const write = (root: string, name: string, text: string) => {
    mkdirSync(join(root, "data"), { recursive: true });
    writeFileSync(join(root, "data", name), text, "utf8");
  };

  it("updates a row it can recognise and creates one it cannot", async () => {
    const root = dir();
    write(root, "service.yaml", "- slug: cut\n  name: Cut and finish\n- slug: new\n  name: New\n");
    const { client, created, updated } = fakeSite({
      service: [entry({ id: "1", slug: "cut", data: { slug: "cut", name: "Cut" } })],
    });

    expect(await pushContent(root, client, spec)).toBe(0);
    expect(updated).toHaveLength(1);
    expect(updated[0]?.id).toBe("1");
    expect(created.map((c) => c.input.slug)).toEqual(["new"]);
  });

  it("keeps a published row published, and a draft a draft", async () => {
    // `pull` writes `__status` only for a draft, so absent means published.
    // Reading absent as the server's default for a new row — draft — made
    // `pull --content` followed by `apply --content` unpublish a whole site
    // in silence, which is a backup that destroys what it restores.
    const root = dir();
    write(
      root,
      "service.yaml",
      "- slug: cut\n  name: Cut\n- slug: wip\n  __status: draft\n  name: WIP\n",
    );
    const { client, created } = fakeSite({ service: [] });

    await pushContent(root, client, spec);
    expect(created.map((c) => [c.input.slug, c.input.status])).toEqual([
      ["cut", "published"],
      ["wip", "draft"],
    ]);
  });

  it("matches an unnamed row by its id", async () => {
    const root = dir();
    write(root, "booking.yaml", "- __id: abc\n  reference: BK-1\n");
    const { client, created, updated } = fakeSite({
      booking: [entry({ id: "abc", data: { reference: "BK-0" } })],
    });

    await pushContent(root, client, spec);
    expect(created).toHaveLength(0);
    expect(updated[0]?.input.data).toEqual({ reference: "BK-1" });
  });

  it("sends the slug as the address and as the field, when the type declares one", async () => {
    const root = dir();
    write(root, "service.yaml", "- slug: cut\n  name: Cut\n");
    const { client, created } = fakeSite({ service: [] });

    await pushContent(root, client, spec);
    // The column the URL reads, and the field the spec declared. Without the
    // second, every row of such a type is refused for a missing field it has.
    expect(created[0]?.input.slug).toBe("cut");
    expect(created[0]?.input.data).toEqual({ slug: "cut", name: "Cut" });
  });

  it("never deletes a row a file happens not to mention", async () => {
    const root = dir();
    write(root, "service.yaml", "- slug: cut\n  name: Cut\n");
    const { client, created, updated } = fakeSite({
      service: [
        entry({ id: "1", slug: "cut", data: { slug: "cut", name: "Cut" } }),
        entry({ id: "2", slug: "braids", data: { slug: "braids", name: "Braids" } }),
      ],
    });

    await pushContent(root, client, spec);
    // An import is a restore or a merge. A file that omits a row is not an
    // instruction to remove it.
    expect(created).toHaveLength(0);
    expect(updated.map((u) => u.id)).toEqual(["1"]);
  });

  it("reports the rows a site refuses and keeps going", async () => {
    const root = dir();
    write(root, "service.yaml", "- slug: one\n  name: One\n- slug: two\n  name: Two\n");
    const { client, created } = fakeSite({ service: [] });
    const failing = {
      ...client,
      createEntry: async (type: string, input: EntryInput) => {
        if (input.slug === "one") throw Object.assign(new Error("nope"), { issues: [] });
        return client.createEntry(type, input);
      },
    } as unknown as Client;

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Non-zero, so a restore in a script does not look like it worked — and the
    // second row still went, because one row's failure is not the import's.
    expect(await pushContent(root, failing, spec)).toBe(1);
    expect(created.map((c) => c.input.slug)).toEqual(["two"]);
  });

  it("refuses a file that is not a list, rather than guessing", async () => {
    const root = dir();
    write(root, "service.yaml", "slug: cut\nname: Cut\n");
    const { client, created } = fakeSite({ service: [] });

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await pushContent(root, client, spec)).toBe(1);
    expect(created).toHaveLength(0);
  });

  it("skips a file naming a type this site does not have", async () => {
    const root = dir();
    write(root, "nonsense.yaml", "- slug: x\n");
    const { client, created } = fakeSite({});

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await pushContent(root, client, spec);
    expect(created).toHaveLength(0);
  });
});
