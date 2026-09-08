import { useState } from "react";
import { Link, useParams } from "react-router";

import { api, type Entry, type Spec } from "../lib/api";
import { useAsync } from "../lib/use-async";

/**
 * One type's rows.
 *
 * The filtering is client-side for now, over what `/api/entries/:type` returns,
 * and that is a stated ceiling rather than a design: the server-rendered list
 * pages and searches in SQL (ADR 0037), and this screen matches it properly
 * once the API grows the same parameters. Until then it says how many it is
 * looking at, so nobody mistakes a filtered view for the whole site.
 */
export function Entries() {
  const { type: typeKey } = useParams();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  const spec = useAsync(() => api.get<{ spec: Spec }>("/api/spec").then((r) => r.spec), []);
  const rows = useAsync(
    () =>
      typeKey
        ? api.get<{ entries: Entry[] }>(`/api/entries/${typeKey}`).then((r) => r.entries)
        : Promise.resolve([]),
    [typeKey],
  );

  const stored = (spec.data?.content ?? []).filter((t) => !t.derived);
  const type = stored.find((t) => t.key === typeKey);

  if (!typeKey) {
    return (
      <>
        <h1>Content</h1>
        <div className="cards">
          {stored.map((t) => (
            <div className="card" key={t.key}>
              <h3>
                <Link to={`/content/${t.key}`}>{t.labelPlural ?? t.label}</Link>
              </h3>
            </div>
          ))}
        </div>
      </>
    );
  }

  if (spec.loading || rows.loading) return <p className="muted">Loading…</p>;
  if (rows.error) return <p className="error">{rows.error}</p>;
  if (!type) return <p className="error">This site has no “{typeKey}” to show.</p>;

  const title = (entry: Entry) =>
    String(entry.data[type.titleField ?? "name"] ?? entry.data["title"] ?? entry.slug ?? "—");

  const shown = (rows.data ?? []).filter((entry) => {
    if (status && entry.status !== status) return false;
    if (!search) return true;
    const haystack = `${entry.slug ?? ""} ${Object.values(entry.data).join(" ")}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  });

  return (
    <>
      <h1>{type.labelPlural ?? type.label}</h1>
      <p className="muted">
        <a href={`/admin/content/${type.key}/new`}>Add {type.label.toLowerCase()}</a>
      </p>

      <form className="filters" onSubmit={(event) => event.preventDefault()} role="search">
        <label>
          <span className="sr-only">Search</span>
          <input
            type="search"
            value={search}
            placeholder="Search these rows…"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Showing</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Everything</option>
            <option value="published">Published</option>
            <option value="draft">Drafts</option>
          </select>
        </label>
      </form>

      <p className="muted">
        {shown.length} of {rows.data?.length ?? 0} loaded
      </p>

      <table>
        <thead>
          <tr>
            <th scope="col">{type.label}</th>
            <th scope="col">Slug</th>
            <th scope="col">On the site</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((entry) => (
            <tr key={entry.id}>
              <td>
                <Link to={`/content/${type.key}/${entry.id}`}>{title(entry)}</Link>
              </td>
              <td className="muted">{entry.slug ?? ""}</td>
              <td>
                <span className={entry.status === "draft" ? "pill" : "pill live"}>
                  {entry.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
