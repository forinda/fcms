#!/usr/bin/env tsx
/**
 * Load an example site into the database.
 *
 * The bridge between the spike and the engine: the same spec that `fcms dev`
 * serves from files becomes the one the HTTP server serves from Postgres. If
 * the page looks the same either way, the `EntrySource` seam held.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { joinFiles } from "@forinda-cms/lang";
import { createDb, closeAllPools, entries, organizations, sites } from "@forinda-cms/db";
import { ApplySpecUseCase } from "../src/modules/admin/use-cases/apply-spec.usecase";

const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const ORG = process.env["ORG_ID"] ?? "default";
const SITE = process.env["SITE_ID"] ?? "default";
/**
 * Which example to load. `EXAMPLE=rooms pnpm seed` for the guesthouse.
 *
 * Two examples now (ADR 0025): the salon is the appointment shape, the rooms
 * are the date-range one, and between them they cover both derived kinds.
 */
const root = join(
  dirname(fileURLToPath(import.meta.url)),
  `../../../examples/${process.env["EXAMPLE"] ?? "salon"}`,
);

const files: Record<string, string> = {
  "site.yaml": readFileSync(join(root, "site.yaml"), "utf8"),
};
for (const section of ["content", "pages", "logic"]) {
  const dir = join(root, section);
  try {
    if (!statSync(dir).isDirectory()) continue;
  } catch {
    continue;
  }
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".yaml"))) {
    files[`${section}/${name}`] = readFileSync(join(dir, name), "utf8");
  }
}

const joined = joinFiles(files);
if (!joined.ok) {
  console.error(joined.diagnostics.map((d) => `${d.file ?? ""} ${d.message}`).join("\n"));
  process.exit(1);
}

const db = createDb(url);

await db.insert(organizations).values({ id: ORG, name: "Default" }).onConflictDoNothing();
await db
  .insert(sites)
  .values({
    id: SITE,
    orgId: ORG,
    slug: "salon",
    name: joined.spec.name,
    timezone: "Africa/Nairobi",
  })
  .onConflictDoNothing();

// Constructed directly rather than resolved: a script has no request, and the
// use-case's constructor is the same one the container calls.
const applySpec = new ApplySpecUseCase(db, { orgId: ORG, siteId: SITE });
const { seq, migration } = await applySpec.execute(joined.spec, {
  actor: "seed",
  source: "cli",
  allowDestructive: true,
});
console.log(`spec applied as patch ${seq}, ${migration.length} migration step(s)`);

// Entry data, from the same `data/*.yaml` the spike reads.
for (const name of readdirSync(join(root, "data")).filter((f) => f.endsWith(".yaml"))) {
  const typeKey = name.replace(/\.ya?ml$/, "");
  const rows = parseYaml(readFileSync(join(root, "data", name), "utf8")) as Record<
    string,
    unknown
  >[];
  for (const row of rows) {
    const slug = String(row["slug"] ?? row["reference"] ?? "");
    await db
      .insert(entries)
      .values({
        siteId: SITE,
        orgId: ORG,
        typeKey,
        slug,
        data: row,
        status: "published",
      })
      // Targeted at the real unique constraint. A bare `onConflictDoNothing()`
      // worked only while the id was derived from the slug; with a generated
      // ULID every re-seed would insert a duplicate row that no constraint on
      // `id` could catch.
      .onConflictDoNothing({ target: [entries.siteId, entries.typeKey, entries.slug] });
  }
  console.log(`  ${typeKey}: ${rows.length} entries`);
}

await closeAllPools();
console.log("seeded");
