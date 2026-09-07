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
  // Both anchors, each walked upward: the bundle's own directory, and wherever
  // the process was started. A fixed number of `..` segments is a guess about
  // repository layout that the layout then invalidates — moving the app into
  // `apps/engine` did exactly that, and the failure only appeared outside the
  // image, which sets `MIGRATIONS_DIR` and therefore never noticed.
  const anchors = [dirname(fileURLToPath(import.meta.url)), process.cwd()];
  const candidates = [process.env["MIGRATIONS_DIR"], ...anchors.flatMap(upward)];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error(
    `no migrations directory found. Looked upward from:\n${anchors
      .map((a) => `  ${a}`)
      .join("\n")}\n` + "Set MIGRATIONS_DIR to point at it.",
  );
}

/** Every place worth looking, from `from` up to the filesystem root. */
function upward(from: string): string[] {
  const out: string[] = [];
  let dir = from;

  for (;;) {
    out.push(join(dir, "migrations"), join(dir, "packages/db/migrations"));
    const parent = dirname(dir);
    if (parent === dir) return out;
    dir = parent;
  }
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
