import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { specQuery, statusQuery } from "@/lib/queries";

/**
 * What the site is, and what just happened to it.
 *
 * The server-rendered dashboard answers "what needs you" from five reads
 * (ADR 0037's drafts, failed runs, unfinished payments). This one starts from
 * what `/api/status` already answers and grows as the API does — a screen that
 * invents numbers the API cannot serve is one that lies on the next refresh.
 */
export default function Dashboard() {
  const status = useQuery(statusQuery);
  const spec = useQuery(specQuery);

  if (status.isPending || spec.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (status.error || spec.error) {
    return (
      <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
        {(status.error ?? spec.error)?.message}
      </p>
    );
  }

  const site = status.data.site;
  const stored = spec.data.content.filter((type) => !type.derived);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{site?.name ?? "This site"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {site?.pages ?? 0} pages · {stored.length} content types ·{" "}
        <a className="underline underline-offset-4" href="/admin/history">
          history
        </a>
      </p>

      <h2 className="mt-8 mb-2 text-lg font-semibold">Content</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stored.map((type) => {
          const count = status.data.counts[type.key] ?? 0;
          return (
            <Card key={type.key}>
              <CardHeader>
                <CardTitle>
                  <Link className="underline-offset-4 hover:underline" to={`/content/${type.key}`}>
                    {type.labelPlural ?? type.label}
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {count} {count === 1 ? "entry" : "entries"}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {status.data.lastChange ? (
        <>
          <h2 className="mt-8 mb-2 text-lg font-semibold">Latest change</h2>
          <p className="text-sm text-muted-foreground">
            {status.data.lastChange.summary} — {status.data.lastChange.actor} via{" "}
            {status.data.lastChange.source}
          </p>
        </>
      ) : null}
    </>
  );
}
