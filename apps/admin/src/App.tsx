import { NavLink, Route, Routes } from "react-router";

import { Dashboard } from "./routes/Dashboard";
import { Entries } from "./routes/Entries";
import { EntryEdit } from "./routes/EntryEdit";
import { NotFound } from "./routes/NotFound";

/**
 * The shell (ADR 0044).
 *
 * The links that are not built yet point at the server-rendered admin, on
 * purpose: for as long as both exist, a half-migrated app that hides what it
 * cannot do yet is less useful than one that hands you across.
 */
export function App() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to the page
      </a>
      <header className="bar">
        <nav aria-label="Sections">
          <NavLink to="/" end>
            Overview
          </NavLink>
          <NavLink to="/content">Content</NavLink>
          <a href="/admin/pages">Pages</a>
          <a href="/admin/types">Types</a>
          <a href="/admin/automations">Automations</a>
          <a href="/admin/settings">Settings</a>
        </nav>
        <nav aria-label="You">
          <a href="/admin/account">You</a>
          <form method="post" action="/admin/logout">
            <button className="quiet" type="submit">
              Sign out
            </button>
          </form>
        </nav>
      </header>

      <main id="main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/content" element={<Entries />} />
          <Route path="/content/:type" element={<Entries />} />
          <Route path="/content/:type/:id" element={<EntryEdit />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </>
  );
}
