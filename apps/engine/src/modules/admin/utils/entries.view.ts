/**
 * A type's entries (ADR 0037).
 *
 * The screen an owner opens more than any other, and the one that was written
 * for a fixture: every row of the type, in whatever order Postgres returned
 * them, with no way to find one. A salon writes a few thousand bookings a year.
 *
 * So: a page at a time, newest first, with a search box, a status filter and a
 * sort — all as plain query parameters on a GET form, which means a filtered
 * list is a URL somebody can bookmark, share or leave open.
 */
import type { ContentType, Field } from "@forinda-cms/spec";
import type { EntryRow } from "@forinda-cms/db";

import { esc } from "./view";

export interface EntryListOptions {
  readonly type: ContentType;
  readonly rows: readonly EntryRow[];
  readonly total: number;
  readonly page: number;
  readonly perPage: number;
  readonly search: string;
  readonly status: "" | "draft" | "published";
  readonly sort: "newest" | "oldest" | "updated" | "title";
}

const SORTS: { value: EntryListOptions["sort"]; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "updated", label: "Recently changed" },
  { value: "title", label: "By name" },
];

export function entryList(options: EntryListOptions): string {
  const { type, rows, total, page, perPage, search, status, sort } = options;
  const label = type.labelPlural ?? type.label;
  const filtered = search !== "" || status !== "";

  const title = (data: Record<string, unknown>) =>
    String(data[type.titleField ?? "name"] ?? data["title"] ?? "—");

  // One extra column, chosen by the type rather than by this file: the first
  // date, state or reference field is what tells two rows apart in a list of
  // bookings, and a table of names and slugs does not.
  //
  // The publish column is headed "On the site" rather than "Status", because a
  // type's own `state` field is usually called Status and two columns under
  // that heading meant neither one.
  const second = secondColumn(type);

  const first = total === 0 ? 0 : (page - 1) * perPage + 1;
  const last = Math.min(page * perPage, total);
  const pages = Math.max(1, Math.ceil(total / perPage));

  const link = (to: number) =>
    `?${new URLSearchParams({
      ...(search ? { q: search } : {}),
      ...(status ? { status } : {}),
      ...(sort === "newest" ? {} : { sort }),
      ...(to === 1 ? {} : { page: String(to) }),
    }).toString()}`;

  return `<h1>${esc(label)}</h1>
${
  type.derived
    ? `<p class="muted">Computed from other content, so there is nothing to edit here.</p>`
    : `<p><a href="/admin/content/${esc(type.key)}/new">Add ${esc(type.label.toLowerCase())}</a></p>`
}

<form method="get" class="filters" role="search">
  <div class="field">
    <label for="q">Search</label>
    <input id="q" name="q" type="search" value="${esc(search)}"
      placeholder="Name or slug…">
  </div>
  <div class="field">
    <label for="status">Showing</label>
    <select id="status" name="status">
      <option value=""${status === "" ? " selected" : ""}>Everything</option>
      <option value="published"${status === "published" ? " selected" : ""}>Published</option>
      <option value="draft"${status === "draft" ? " selected" : ""}>Drafts</option>
    </select>
  </div>
  <div class="field">
    <label for="sort">Ordered</label>
    <select id="sort" name="sort">
      ${SORTS.map(
        (s) =>
          `<option value="${s.value}"${s.value === sort ? " selected" : ""}>${esc(s.label)}</option>`,
      ).join("")}
    </select>
  </div>
  <button type="submit">Apply</button>
  ${filtered ? `<a class="clear" href="?">Clear</a>` : ""}
</form>

${
  rows.length === 0
    ? `<p class="muted">${
        filtered ? "Nothing matches that." : `No ${esc(label.toLowerCase())} yet.`
      }</p>`
    : `<p class="muted count">${first}–${last} of ${total}</p>
<table>
  <caption class="sr-only">${esc(label)}</caption>
  <thead><tr>
    <th scope="col">${esc(type.label)}</th>
    ${second ? `<th scope="col">${esc(second.label)}</th>` : ""}
    <th scope="col">Slug</th>
    <th scope="col">On the site</th>
    <th scope="col"><span class="sr-only">Actions</span></th>
  </tr></thead>
  <tbody>${rows
    .map(
      (r) => `<tr>
    <td>${
      type.derived
        ? esc(title(r.data))
        : `<a href="/admin/content/${esc(type.key)}/${esc(r.id)}">${esc(title(r.data))}</a>`
    }</td>
    ${second ? `<td class="muted">${esc(cell(r.data[second.name], second))}</td>` : ""}
    <td class="muted">${esc(r.slug ?? "")}</td>
    <td><span class="pill${r.status === "draft" ? "" : " live"}">${esc(r.status)}</span></td>
    <td>${
      type.derived
        ? ""
        : `<form method="post" action="/admin/content/${esc(type.key)}/${esc(r.id)}/status" class="inline">
           <input type="hidden" name="status" value="${r.status === "draft" ? "published" : "draft"}">
           <button class="link" type="submit">${r.status === "draft" ? "publish" : "unpublish"}</button>
         </form>`
    }</td>
  </tr>`,
    )
    .join("")}</tbody>
</table>
${
  pages > 1
    ? `<nav class="pager" aria-label="Pages of ${esc(label.toLowerCase())}">
  ${page > 1 ? `<a href="${esc(link(page - 1))}" rel="prev">Previous</a>` : `<span class="muted">Previous</span>`}
  <span class="muted">Page ${page} of ${pages}</span>
  ${page < pages ? `<a href="${esc(link(page + 1))}" rel="next">Next</a>` : `<span class="muted">Next</span>`}
</nav>`
    : ""
}`
}`;
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
