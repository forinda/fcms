import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import "./styles.css";

/**
 * The document, and the one thing every screen shares: a query client.
 *
 * TanStack Query owns what the server said — caching it, refetching it, and
 * telling several screens about one change. Before it, every screen re-fetched
 * on every visit and a save left the list it came from stale until a reload.
 */
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex,nofollow" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  // Created once per browser rather than per render: a client rebuilt on every
  // render is a cache that never hits.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The admin is a tab somebody leaves open. Refetching when they
            // come back is the difference between a dashboard and a photograph
            // of one.
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <Outlet />
    </QueryClientProvider>
  );
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "Something went wrong.";

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">That did not work</h1>
      <p role="alert" className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-destructive">
        {message}
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        <a className="underline underline-offset-4" href="/app">
          Back to the overview
        </a>
        , or the{" "}
        <a className="underline underline-offset-4" href="/admin">
          rest of the admin
        </a>
        .
      </p>
    </main>
  );
}
