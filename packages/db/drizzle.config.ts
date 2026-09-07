import { defineConfig } from "drizzle-kit";

/**
 * One database, not the control/tenant split `enaton` uses.
 *
 * ADR 0013 and doc 09 both land here: a self-hoster running one site should not
 * operate a control plane, so v1 scopes by column rather than by database. The
 * *schema layout* keeps the seam — every table carries `org_id` and `site_id`
 * from the first migration — so the hosted tier can switch the resolver to
 * database-per-site later with the provisioning code already proven.
 */
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: { url: process.env["DATABASE_URL"] ?? "" },
});
