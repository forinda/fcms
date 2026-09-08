import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { specQuery } from "@/lib/queries";

/** Every type that stores rows. The derived ones are computed, so not here. */
export default function Content() {
  const spec = useQuery(specQuery);
  if (spec.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (spec.error) {
    return (
      <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
        {spec.error.message}
      </p>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Content</h1>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {spec.data.content
          .filter((type) => !type.derived)
          .map((type) => (
            <Card key={type.key}>
              <CardHeader>
                <CardTitle>
                  <Link className="underline-offset-4 hover:underline" to={`/content/${type.key}`}>
                    {type.labelPlural ?? type.label}
                  </Link>
                </CardTitle>
              </CardHeader>
            </Card>
          ))}
      </div>
    </>
  );
}
