/**
 * A type's entries (ADR 0037), as the props of `Entries/Index` (ADR 0051).
 *
 * The screen an owner opens more than any other, and the one that was written
 * for a fixture: every row of the type, in whatever order Postgres returned
 * them, with no way to find one. A salon writes a few thousand bookings a year.
 *
 * So: a page at a time, newest first, with a search box, a status filter and a
 * sort — all as query parameters, which means a filtered list is a URL
 * somebody can bookmark, share or leave open.
 *
 * What a cell says is decided here rather than in the page, so the page shows
 * strings and never learns what a field type is.
 */
import type { ContentType, Field } from "@forinda-cms/spec";
import type { EntryRow } from "@forinda-cms/db";

export interface EntryListOptions {
  readonly type: ContentType;
  readonly rows: readonly EntryRow[];
  readonly total: number;
  readonly page: number;
  readonly perPage: number;
  readonly search: string;
  readonly status: "" | "draft" | "published";
  readonly sort: "newest" | "oldest" | "updated" | "title";
  /** Whether the publish buttons are offered; the POST checks again. */
  readonly canWrite: boolean;
}

export function entryList(options: EntryListOptions) {
  const { type, rows, total, page, perPage, search, status, sort, canWrite } = options;

  // One extra column, chosen by the type rather than by this file: the first
  // date, state or reference field is what tells two rows apart in a list of
  // bookings, and a table of names and slugs does not.
  const second = secondColumn(type);

  return {
    type: {
      key: type.key,
      label: type.label,
      labelPlural: type.labelPlural ?? type.label,
      derived: Boolean(type.derived),
    },
    // The publish column is headed "On the site" in the page rather than
    // "Status", because a type's own `state` field is usually called Status and
    // two columns under that heading meant neither one.
    secondLabel: second?.label ?? null,
    rows: rows.map((r) => ({
      id: r.id,
      title: String(r.data[type.titleField ?? "name"] ?? r.data["title"] ?? "—"),
      second: second ? cell(r.data[second.name], second) : null,
      slug: r.slug ?? "",
      status: r.status,
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / perPage)),
    perPage,
    filters: { q: search, status, sort },
    canWrite: canWrite && !type.derived,
  };
}

/**
 * The column worth showing beside the name.
 *
 * A booking's date, an enquiry's status, an order's customer. Chosen from what
 * the type declares rather than configured, because a list that shows only
 * names and slugs makes an owner open every row to find the one they want.
 */
function secondColumn(type: ContentType): Field | undefined {
  const usable = type.fields.filter((f) => f.name !== type.titleField && f.name !== "slug");
  const order = ["state", "datetime", "date", "reference", "select", "number"];
  for (const kind of order) {
    const found = usable.find((f) => f.type === kind);
    if (found) return found;
  }
  return undefined;
}

/** A value in a cell: readable, short, and never a raw object. */
function cell(value: unknown, field: Field): string {
  if (value === undefined || value === null || value === "") return "—";
  if (field.type === "datetime" || field.type === "date") {
    const at = new Date(String(value));
    if (!Number.isNaN(at.getTime())) {
      return field.type === "date"
        ? at.toISOString().slice(0, 10)
        : at.toISOString().replace("T", " ").slice(0, 16);
    }
  }
  if (typeof value === "object") return "—";
  return String(value);
}
