/**
 * The baseline is the database the Drizzle migrations built.
 *
 * If it is not, every existing install fails its first boot on kickjs-db with a
 * drift error — or worse, passes it with a schema that differs from a fresh
 * install's. So each path an install can arrive by is built for real and
 * compared with a fresh one: finished Drizzle history, history that stopped
 * partway (a self-hoster who skipped releases), and a second boot.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import pg from "pg";
import { introspectPg, migrateRollback } from "@forinda/kickjs-db";
import { pgAdapter, type PgPoolLike } from "@forinda/kickjs-db/pg";
import { pglitePool } from "@forinda/kickjs-db/pglite";

import { migrate } from "./migrate.js";

const pkg = fileURLToPath(new URL("../..", import.meta.url));
const dirs = { migrationsDir: join(pkg, "kickdb/migrations"), legacyDir: join(pkg, "migrations") };

interface Opened {
  readonly pool: PgPoolLike;
  /** Drizzle's own migrator, as an install on the old release ran it. */
  drizzleMigrate(folder: string): Promise<void>;
  close(): Promise<void>;
}

const embedded = async (): Promise<Opened> => {
  const db = new PGlite();
  return {
    pool: pglitePool(db),
    drizzleMigrate: (folder) => migratePglite(drizzlePglite(db), { migrationsFolder: folder }),
    close: () => db.close(),
  };
};

/**
 * A throwaway database on the server in `DATABASE_URL`, when there is one —
 * never that database itself, which the engine's suites use.
 */
const server = process.env["DATABASE_URL"]?.match(/^postgres(ql)?:\/\//)
  ? new URL(process.env["DATABASE_URL"])
  : undefined;
const reachable = server
  ? await new pg.Client({ connectionString: server.href })
      .connect()
      .then((c) => c.end().then(() => true))
      .catch(() => false)
  : false;
if (server && !reachable)
  console.warn(`[baseline] ${server.host} unreachable: server Postgres skipped`);

const onServer = async (): Promise<Opened> => {
  const admin = new pg.Client({ connectionString: server!.href });
  await admin.connect();
  const name = `fcms_kdb_${Math.random().toString(36).slice(2, 10)}`;
  await admin.query(`create database ${name}`);
  const url = new URL(server!.href);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.href });
  const sql = postgres(url.href, { onnotice: () => undefined });
  return {
    pool,
    drizzleMigrate: (folder) => migratePostgres(drizzlePostgres(sql), { migrationsFolder: folder }),
    close: async () => {
      await sql.end();
      await pool.end();
      await admin.query(`drop database ${name}`);
      await admin.end();
    },
  };
};

const opened: Opened[] = [];
const scratch: string[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.close();
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Drizzle's migrations, cut off after the first `count`. */
function legacyFolder(count?: number): string {
  if (count === undefined) return dirs.legacyDir;
  const folder = mkdtempSync(join(tmpdir(), "fcms-legacy-"));
  scratch.push(folder);
  cpSync(dirs.legacyDir, folder, { recursive: true });
  const path = join(folder, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(path, "utf8"));
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(path, JSON.stringify(journal));
  return folder;
}

const schemaOf = (db: Opened) => introspectPg(db.pool);
const ledgerOf = async (db: Opened) =>
  (await db.pool.query("select id, name, hash, batch from kick_migrations order by id")).rows;

describe.each([
  ["PGlite", embedded, true],
  ["server Postgres", onServer, reachable],
] as const)(
  "kickjs-db baseline on %s",
  (_, open, enabled) => {
    const fresh = async () => {
      const db = await open();
      opened.push(db);
      return db;
    };
    const legacy = async (count?: number) => {
      const db = await fresh();
      await db.drizzleMigrate(legacyFolder(count));
      return db;
    };

    it.runIf(enabled)("builds a fresh install", async () => {
      const db = await fresh();
      const { applied } = await migrate(db.pool, dirs);
      expect(applied).toHaveLength(1);

      // And back: `down.sql` drops children before the tables they reference.
      await migrateRollback({
        adapter: pgAdapter({ pool: db.pool }),
        migrationsDir: dirs.migrationsDir,
      });
      expect((await schemaOf(db)).tables).toEqual({});
    });

    it.runIf(enabled)(
      "waits for another replica's migration instead of failing the boot",
      async () => {
        const db = await fresh();
        await migrate(db.pool, dirs);
        await db.pool.query(
          "update kick_migrations_lock set locked_at = now(), locked_by = 'replica-2'",
        );
        setTimeout(
          () =>
            void db.pool.query(
              "update kick_migrations_lock set locked_at = null, locked_by = null",
            ),
          1500,
        );

        await expect(migrate(db.pool, dirs)).resolves.toMatchObject({ applied: [] });
      },
    );

    it.runIf(enabled)(
      "adopts a finished Drizzle install without running anything, and the schemas match",
      async () => {
        const reference = await fresh();
        await migrate(reference.pool, dirs);

        const db = await legacy();
        const { applied } = await migrate(db.pool, dirs);

        expect(applied).toEqual([]);
        expect(await ledgerOf(db)).toEqual(await ledgerOf(reference));
        expect(await schemaOf(db)).toEqual(await schemaOf(reference));
      },
    );

    it.runIf(enabled)(
      "finishes Drizzle history an install had not reached, then adopts",
      async () => {
        const reference = await fresh();
        await migrate(reference.pool, dirs);

        const db = await legacy(5);
        await migrate(db.pool, dirs);

        expect(await schemaOf(db)).toEqual(await schemaOf(reference));
      },
    );

    it.runIf(enabled)(
      "is a no-op on the next boot, and leaves the planner's indexes alone",
      async () => {
        const db = await legacy();
        await migrate(db.pool, dirs);
        await db.pool.query(
          `create index ix_e_test on entries ((data->>'price')) where site_id = 's' and type_key = 't'`,
        );

        await expect(migrate(db.pool, dirs)).resolves.toMatchObject({ applied: [] });
        expect(await ledgerOf(db)).toHaveLength(1);
      },
    );
    // Each case builds two or three real databases, and PGlite starts in seconds.
  },
  30_000,
);
