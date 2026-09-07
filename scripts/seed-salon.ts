#!/usr/bin/env tsx
/**
 * Load `examples/salon` into the database.
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
import { Site, createDb, closeAllPools, entries, organizations, sites } from "@forinda-cms/db";

const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const ORG = process.env["ORG_ID"] ?? "default";
const SITE = process.env["SITE_ID"] ?? "default";
const root = join(dirname(fileURLToPath(import.meta.url)), "../examples/salon");

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

const site = new Site(db, { orgId: ORG, siteId: SITE });
const { seq, migration } = await site.applySpec(joined.spec, {
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
        id: `${typeKey}:${slug}`,
        siteId: SITE,
        orgId: ORG,
        typeKey,
        slug,
        data: row,
        status: "published",
      })
      .onConflictDoNothing();
  }
  console.log(`  ${typeKey}: ${rows.length} entries`);
}

await closeAllPools();
console.log("seeded");
