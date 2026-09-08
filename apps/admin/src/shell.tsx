import { NavLink, Outlet } from "react-router";

import { Button } from "@/components/ui/button";

/**
 * The shell (ADR 0044).
 *
 * The links that are not built yet point at the server-rendered admin, on
 * purpose: for as long as both exist, a half-migrated app that hides what it
 * cannot do is less useful than one that hands you across.
 */
const HERE = [
  { to: "/", label: "Overview", end: true },
  { to: "/content", label: "Content", end: false },
];

const THERE = [
  { href: "/admin/pages", label: "Pages" },
  { href: "/admin/types", label: "Types" },
  { href: "/admin/automations", label: "Automations" },
  { href: "/admin/settings", label: "Settings" },
];

export default function Shell() {
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
          {HERE.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                isActive
                  ? "font-semibold text-foreground underline underline-offset-4"
                  : "text-muted-foreground hover:text-foreground"
              }
            >
              {link.label}
            </NavLink>
          ))}
          {THERE.map((link) => (
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
        <Outlet />
      </main>
    </>
  );
}
