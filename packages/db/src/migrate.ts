/**
 * Running migrations.
 *
 * Drizzle's migrator keeps its ledger inside the target database, which makes
 * this **idempotent and resumable** — the property provisioning relies on
 * (doc 09 §6), and the reason the install artifact can migrate on boot rather
 * than asking a self-hoster to run a command.
 *
 * Exposed as a function rather than only a script so the app can call it from a
 * lifecycle hook without taking a direct dependency on Drizzle.
 */
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDb, type Db } from "./client.js";

/**
 * Where the SQL lives at runtime.
 *
 * Migration files are data, not part of the JS bundle, so they must sit beside
 * the running code rather than only in the repository — the trap doc 09 records
 * where omitting the copy makes provisioning work in dev and fail in the
 * deployed image.
 */
export function migrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env["MIGRATIONS_DIR"],
    join(here, "migrations"),
    join(here, "../migrations"),
    join(process.cwd(), "migrations"),
    join(process.cwd(), "packages/db/migrations"),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error(
    `no migrations directory found. Looked in:\n${candidates
      .filter(Boolean)
      .map((c) => `  ${c}`)
      .join("\n")}\n` + "Set MIGRATIONS_DIR to point at it.",
  );
}

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: migrationsFolder() });
}

/** Entry point for `pnpm db:migrate`. */
export async function migrateFromEnv(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is not set");
  await runMigrations(createDb(url));
}
