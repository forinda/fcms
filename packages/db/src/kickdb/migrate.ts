/**
 * Migrating on boot with kickjs-db, from a database Drizzle migrated.
 *
 * kickjs-db does not read Drizzle's ledger, so an existing install would see
 * the baseline as pending and run `CREATE TABLE` against tables it already has.
 * `adoptDrizzle` closes that gap once per install: it finishes whatever Drizzle
 * migrations the install had not reached — a self-hoster may skip releases —
 * and then records the baseline as applied without running it, because the
 * schema it would create is the one those migrations already built.
 *
 * Nobody is present when this runs (doc 09 target B), so it is idempotent: a
 * boot interrupted anywhere in it repeats it, and the second run finds either
 * nothing left to do or the same work still pending.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeMigrationHash,
  migrateLatest,
  migrationsTableDdl,
  readJournal,
  type AppliedSummary,
} from "@forinda/kickjs-db";
import { pgAdapter, type PgClientLike, type PgPoolLike } from "@forinda/kickjs-db/pg";

/**
 * The planner's per-site indexes (`planner.ts`). They are created at runtime
 * from the spec, so no migration snapshot contains them.
 */
export const RUNTIME_INDEXES = /^(ix|ux)_e_/;

export interface MigrateOptions {
  /** kickjs-db migrations: the baseline, and everything after it. */
  readonly migrationsDir: string;
  /** Drizzle's migrations, kept only to finish an install that is behind. */
  readonly legacyDir: string;
}

export async function migrate(pool: PgPoolLike, opts: MigrateOptions): Promise<AppliedSummary> {
  const adapter = pgAdapter({ pool });
  await adapter.ensureMigrationTables();
  await adoptDrizzle(pool, opts);
  return migrateLatest({
    adapter,
    migrationsDir: opts.migrationsDir,
    driftIgnore: { indexes: RUNTIME_INDEXES },
  });
}

export async function adoptDrizzle(pool: PgPoolLike, opts: MigrateOptions): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Two replicas booting together must not both adopt.
    await client.query("select pg_advisory_xact_lock(hashtext('forinda-cms:adopt-drizzle'))");
    const legacy = await client.query<{ t: string | null }>(
      "select to_regclass('drizzle.__drizzle_migrations')::text as t",
    );
    const adopted = await client.query("select 1 from kick_migrations limit 1");
    if (legacy.rows[0]?.t && adopted.rows.length === 0) {
      await finishDrizzle(client, opts.legacyDir);
      await recordBaseline(client, opts.migrationsDir);
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** What Drizzle's migrator would have done next: every journal entry newer than the last applied. */
async function finishDrizzle(client: PgClientLike, legacyDir: string): Promise<void> {
  const journal = JSON.parse(readFileSync(join(legacyDir, "meta/_journal.json"), "utf8")) as {
    entries: { tag: string; when: number }[];
  };
  const last = await client.query<{ at: string | null }>(
    "select max(created_at)::text as at from drizzle.__drizzle_migrations",
  );
  const after = Number(last.rows[0]?.at ?? 0);

  for (const { tag, when } of journal.entries.filter((e) => e.when > after)) {
    const sql = readFileSync(join(legacyDir, `${tag}.sql`), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.query(statement);
    }
    await client.query(
      "insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)",
      [createHash("sha256").update(sql).digest("hex"), when],
    );
  }
}

async function recordBaseline(client: PgClientLike, migrationsDir: string): Promise<void> {
  const [baseline] = (await readJournal(migrationsDir, "postgres")).entries;
  if (!baseline) throw new Error(`no baseline migration in ${migrationsDir}`);
  // Created by `ensureMigrationTables` already; repeated here so this function
  // stands on its own. `if not exists`, so it costs nothing.
  for (const ddl of migrationsTableDdl("postgres").split(";")) {
    if (ddl.trim()) await client.query(ddl);
  }
  await client.query(
    "insert into kick_migrations (id, name, hash, batch) values ($1, $2, $3, 1) on conflict do nothing",
    [baseline.id, baseline.tag, await computeMigrationHash(join(migrationsDir, baseline.id))],
  );
}
