/**
 * Running migrations.
 *
 * kickjs-db's runner keeps its ledger inside the target database, which makes
 * this **idempotent and resumable**: the property provisioning relies on
 * (doc 09 §6), and the reason the install artifact can migrate on boot rather
 * than asking a self-hoster to run a command. An install Drizzle migrated is
 * adopted on its first boot (ADR 0052, `kickdb/migrate.ts`).
 *
 * Exposed as a function rather than only a script so the app can call it from a
 * lifecycle hook without taking a direct dependency on the runner.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { pglitePool } from "@forinda/kickjs-db/pglite";

import { embeddedFor, isEmbedded } from "./client.js";
import { migrate } from "./kickdb/migrate.js";

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
      .join("\n")}\nSet MIGRATIONS_DIR to point at it.`,
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

/**
 * Drizzle's folder, and kickjs-db's beside it.
 *
 * Kept as a pair so that wherever the legacy folder is found — the repository,
 * the image's `/app/migrations`, a packed install — the new one is found with
 * it, and nothing has to be configured twice.
 */
export function migrationDirs(): { legacyDir: string; migrationsDir: string } {
  const legacyDir = migrationsFolder();
  return { legacyDir, migrationsDir: join(dirname(legacyDir), "kickdb/migrations") };
}

export async function runMigrations(url: string): Promise<void> {
  // The embedded database is the instance the app already holds: a second
  // PGlite on the same directory is a second process on its files. A server
  // gets a pool of its own for the duration, closed before boot goes on.
  if (isEmbedded(url)) {
    await migrate(pglitePool(embeddedFor(url)), migrationDirs());
    return;
  }
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    await migrate(pool, migrationDirs());
  } finally {
    await pool.end();
  }
}

/** Entry point for `pnpm db:migrate`. */
export async function migrateFromEnv(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is not set");
  await runMigrations(url);
}
