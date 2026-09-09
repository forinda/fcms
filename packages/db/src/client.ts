/**
 * Connections.
 *
 * One pool per connection URL, cached (doc 09 §7), so N sites on one instance
 * share one pool rather than opening N. Fifteen lines that avoid the obvious
 * bug.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import postgres from "postgres";

import * as schema from "./schema/index.js";

/**
 * The pool, and how many holders it has.
 *
 * The count is what makes a cached pool safe to hand out twice. Under `kick
 * dev` two applications overlap for a moment on every save — the reloaded one
 * builds while the previous one shuts down — and they share this map, so a
 * shutdown that simply ended the pool ended the *new* app's connection with
 * it. Every request after a file save then failed with `write
 * CONNECTION_ENDED`, and the fix looked like restarting the dev server.
 *
 * One number rather than a per-application pool, because sharing is the point:
 * N sites on one instance share one pool (doc 09 §7).
 */
interface Pool {
  readonly sql: postgres.Sql;
  holders: number;
}

const pools = new Map<string, Pool>();

function poolFor(url: string): postgres.Sql {
  let pool = pools.get(url);
  if (!pool) {
    pool = { sql: postgres(url, { max: 10, onnotice: () => {} }), holders: 0 };
    pools.set(url, pool);
  }
  pool.holders += 1;
  return pool.sql;
}

/**
 * Embedded instances, cached the way pools are and for the same reason.
 *
 * PGlite is single-connection by construction, so a second instance on the same
 * directory is not a second connection — it is a second process trying to open
 * the same data files. One per directory, always.
 */
const embedded = new Map<string, PGlite>();

/**
 * Refuse a data directory another process is already using.
 *
 * The embedded database is one process as well as one connection, and nothing
 * stops a second one opening the same directory — PGlite writes a
 * `postmaster.pid`, but the pid in it is the constant `-42`, so it identifies
 * nothing. Two processes on one directory corrupts it *permanently*: the second
 * boot succeeds, and every boot after that dies in the WASM runtime with
 * `RuntimeError: Aborted()`, with no `pg_ctl` to recover it.
 *
 * That happened here — a restart that overlapped its predecessor by a few
 * seconds destroyed a site's database — so this is a lock with a real pid in
 * it, checked before the directory is opened rather than after it is ruined.
 *
 * A stale lock is taken over rather than obeyed: a machine that lost power
 * leaves one behind, and refusing to start until somebody deletes a file they
 * have never heard of is its own kind of data loss.
 */
function claim(dir: string): void {
  const lock = join(resolve(dir), "fcms.lock");

  const held = readPid(lock);
  if (held !== null && held !== process.pid && alive(held)) {
    throw new Error(
      `the database in ${resolve(dir)} is already open in process ${held}.\n` +
        `  An embedded database is one process: a second one corrupts it permanently.\n` +
        `  Stop the other server, or point this one somewhere else with DATABASE_URL.`,
    );
  }

  mkdirSync(resolve(dir), { recursive: true });
  writeFileSync(lock, String(process.pid), "utf8");

  // Best effort, and only best effort: a killed process leaves the file behind,
  // which is what the staleness check above is for.
  const release = () => {
    try {
      if (readPid(lock) === process.pid) rmSync(lock, { force: true });
    } catch {
      // Releasing a lock is not worth failing a shutdown over.
    }
  };
  process.once("exit", release);
  process.once("SIGINT", release);
  process.once("SIGTERM", release);
}

function readPid(lock: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(lock, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Signal 0 asks whether a process exists without touching it. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // `EPERM` means it exists and belongs to somebody else, which still counts.
    return (error as { code?: string }).code === "EPERM";
  }
}

/** A server, or a directory. Anything that is not a URL is a place to put files. */
export function isEmbedded(url: string): boolean {
  return !/^postgres(ql)?:\/\//.test(url);
}

/**
 * A connection to the site's database (ADR 0050).
 *
 * `postgres://…` is a server somebody runs. Anything else is a directory, and
 * the database runs inside this process — real Postgres 18, compiled to WASM,
 * with nothing to install and nothing listening on a port. That is the default,
 * because obtaining a Postgres was the last thing standing between somebody and
 * a working site.
 *
 * The same dialect either way, which is the whole reason this is one function
 * and not an abstraction: the SQL, the schema and the migrations do not know
 * which they are talking to.
 */
export function createDb(url: string) {
  if (isEmbedded(url)) {
    let client = embedded.get(url);
    if (!client) {
      // PGlite creates its own directory but not the ones above it, and the
      // default is nested — so a first boot in an empty directory failed with
      // `ENOENT: mkdir`, which is the one boot that has to work.
      mkdirSync(dirname(resolve(url)), { recursive: true });
      claim(url);
      client = new PGlite(url);
      embedded.set(url, client);
    }
    return drizzlePglite(client, { schema, casing: "snake_case" }) as unknown as ReturnType<
      typeof drizzle<typeof schema>
    >;
  }
  return drizzle(poolFor(url), { schema, casing: "snake_case" });
}

/**
 * Let go of one holder's pool, closing it only when nobody is left.
 *
 * What an application calls on shutdown. `closeAllPools` stays for tests and
 * for the end of the process, where "nobody else can be using it" is true by
 * construction.
 */
export async function releaseDb(url: string): Promise<void> {
  const pool = pools.get(url);
  if (!pool) return;

  pool.holders -= 1;
  if (pool.holders > 0) return;

  pools.delete(url);
  await pool.sql.end({ timeout: 5 });
}

export type Db = ReturnType<typeof createDb>;

/**
 * A database *or* a transaction.
 *
 * Drizzle's transaction callback receives a `PgTransaction`, which is not a
 * `Db` — it has no `$client`. Repositories that accept an optional `tx` were
 * casting it back with `as Db`, which is a lie the compiler was talked out of
 * rather than a type.
 *
 * Derived from `transaction`'s own callback signature, so it stays correct if
 * Drizzle changes shape, and nothing has to cast.
 */
export type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** For tests and graceful shutdown. */
export async function closeAllPools(): Promise<void> {
  const open = [...pools.values()];
  pools.clear();
  await Promise.all(open.map((pool) => pool.sql.end({ timeout: 5 })));
}

/**
 * The rows of a raw `db.execute`, whichever driver ran it.
 *
 * `postgres-js` resolves to the rows themselves; `pglite` resolves to
 * `{ rows }`. Nothing else in the two drivers differs for this codebase, and it
 * is not a dialect difference at all — the SQL is identical — so it belongs
 * here rather than in `dialect.ts` and certainly not in a caller.
 *
 * Found by running the engine suite against both: three tests failed, all of
 * them this, and one of them silently — `databaseNow()` read no row, fell back
 * to `new Date()`, and the queue went back to trusting the process's clock,
 * which is the exact bug that comment exists to prevent.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}
