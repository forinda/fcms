import { usePage } from "@inertiajs/react";
import type { ReactNode } from "react";

import { Button } from "./components/ui/button";

/**
 * The chrome every admin page shares (ADR 0051).
 *
 * Plain links, not Inertia `<Link>`s: most of the admin is still template
 * strings, and a client visit to one would get HTML where it expects a page.
 * A link becomes a `<Link>` when the screen behind it moves.
 *
 * The skip link, the focus ring and the labelled landmarks were built in the
 * server-rendered admin and are built again here, before the screens (ADR
 * 0044's consequence, which still holds).
 */
const SECTIONS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/pages", label: "Pages" },
  { href: "/admin/types", label: "Types" },
  { href: "/admin/automations", label: "Automations" },
  { href: "/admin/settings", label: "Settings" },
];

export function Layout({ children }: { children: ReactNode }) {
  // What the controllers `flash()`: a line of success or of refusal.
  const flash = usePage().flash as { success?: string; error?: string } | undefined;

  return (
    <>
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:m-2 focus:rounded-md focus:bg-card focus:px-4 focus:py-2"
        href="#main"
      >
        Skip to the page
      </a>

      <header className="flex flex-wrap items-center justify-between gap-4 border-b bg-card px-4 py-3">
        <nav aria-label="Sections" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {SECTIONS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-muted-foreground hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <nav aria-label="You" className="flex items-center gap-3 text-sm">
          <a href="/admin/account" className="text-muted-foreground hover:text-foreground">
            You
          </a>
          <form method="post" action="/admin/logout">
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </nav>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 py-6">
        {/* Said where the eye already is, and announced: a save that
            happened somewhere nobody looked did not happen. */}
        {flash?.success ? (
          <p role="status" className="mb-4 rounded-md bg-primary/10 px-3 py-2 text-sm">
            {flash.success}
          </p>
        ) : null}
        {flash?.error ? (
          <p
            role="alert"
            className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {flash.error}
          </p>
        ) : null}
        {children}
      </main>
    </>
  );
}
