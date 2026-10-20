/**
 * The admin's pages (ADR 0051).
 *
 * A controller names a page — `inertia("Entries/Index", props)` — and this
 * finds it under `pages/`. Routing, data and redirects are the server's; what
 * is left here is drawing.
 *
 * Always rendered in the browser, never hydrated: the admin has no
 * server-side render (ADR 0051 §3).
 */
import "./styles.css";

import { createInertiaApp } from "@inertiajs/react";
import { createRoot } from "react-dom/client";

// Lazy, so each page is its own chunk and a screen costs its weight only when
// somebody opens it — forty screens in one entry is the phone doc 14 is
// about, waiting.
const pages = import.meta.glob("./pages/**/*.tsx");

void createInertiaApp({
  resolve: (name) => pages[`./pages/${name}.tsx`]?.() as never,
  setup({ el, App, props }) {
    createRoot(el).render(<App {...props} />);
  },
});
