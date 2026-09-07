/**
 * @forinda-cms/render — the deterministic runtime.
 *
 * Spec in, HTML out, with no model in the request path (doc 02). SSR is the
 * default rather than a mode: no major AI crawler executes JavaScript, so a
 * client-rendered page is invisible to them (doc 08), and at ~90% mobile access
 * server-rendered HTML is also simply the faster thing to send (doc 14).
 */
export * from "./html.js";
export * from "./css.js";
export * from "./entries.js";
export * from "./scope.js";
export * from "./blocks.js";
export * from "./seo.js";
export * from "./render.js";
