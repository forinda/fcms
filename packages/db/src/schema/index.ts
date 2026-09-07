/**
 * The schema, one file per table.
 *
 * Drizzle reads this barrel, so a new table is one file plus one line here —
 * and a model is findable by its name rather than by scrolling.
 *
 * Three decisions from the dossier are load-bearing and each is documented at
 * the table it shapes rather than here: `org_id` + `site_id` on everything
 * (ADR 0002 seam 1, ADR 0008), `jsonb` for user-defined fields rather than EAV
 * (doc 03 §2), and `spec_patches` carrying an inverse for every change (doc 03).
 */
export * from "./_shared.js";
export * from "./organizations.js";
export * from "./sites.js";
export * from "./site-specs.js";
export * from "./spec-patches.js";
export * from "./entries.js";
export * from "./assets.js";
export * from "./owners.js";
export * from "./visitors.js";
export * from "./payments.js";
export * from "./workflow-runs.js";
