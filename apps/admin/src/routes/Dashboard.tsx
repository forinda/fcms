import { Link } from "react-router";

import { api, type Spec, type Status } from "../lib/api";
import { useAsync } from "../lib/use-async";

/**
 * What the site is, and what just happened to it.
 *
 * The server-rendered dashboard answers "what needs you" from five reads
 * (ADR 0037's list, failed runs, unfinished payments). This one starts from
 * what `/api/status` already answers and grows as the API does — a screen that
 * invents numbers the API cannot serve is a screen that lies on the next
 * refresh.
 */
export function Dashboard() {
  const status = useAsync(() => api.get<Status>("/api/status"), []);
  const spec = useAsync(() => api.get<{ spec: Spec }>("/api/spec").then((r) => r.spec), []);

  if (status.loading || spec.loading) return <p className="muted">Loading…</p>;
  if (status.error) return <p className="error">{status.error}</p>;
  if (spec.error) return <p className="error">{spec.error}</p>;

  const site = status.data?.site;
  const stored = (spec.data?.content ?? []).filter((type) => !type.derived);

  return (
    <>
      <h1>{site?.name ?? "This site"}</h1>
      <p className="muted">
        {site?.pages ?? 0} pages · {stored.length} content types ·{" "}
        <a href="/admin/history">history</a>
      </p>

      <h2>Content</h2>
      <div className="cards">
        {stored.map((type) => {
          const count = status.data?.counts[type.key] ?? 0;
          return (
            <div className="card" key={type.key}>
              <h3>
                <Link to={`/content/${type.key}`}>{type.labelPlural ?? type.label}</Link>
              </h3>
              <p className="muted">
                {count} {count === 1 ? "entry" : "entries"}
              </p>
            </div>
          );
        })}
      </div>

      {status.data?.lastChange ? (
        <>
          <h2>Latest change</h2>
          <p className="muted">
            {status.data.lastChange.summary} — {status.data.lastChange.actor} via{" "}
            {status.data.lastChange.source}
          </p>
        </>
      ) : null}
    </>
  );
}
