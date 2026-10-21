/**
 * Connections.
 *
 * One pool per connection URL, cached (doc 09 §7), so N sites on one instance
 * share one pool rather than opening N. Fifteen lines that avoid the obvious
 * bug.
 */
import { PGlite } from "@electric-sql/pglite";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import pg from "pg";
import type { Insertable, Selectable } from "@forinda/kickjs-db";
import {
  createDbClient,
  safeNullComparison,
  type KickDbClient,
  type SchemaToTypes,
} from "@forinda/kickjs-db";
import { pgDialect, type PgPoolLike } from "@forinda/kickjs-db/pg";
import { pglitePool } from "@forinda/kickjs-db/pglite";

import * as schema from "./schema.js";

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

/** The one PGlite instance for a directory, opened on first use. */
export function embeddedFor(url: string): PGlite {
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
  return client;
}

/** A server, or a directory. Anything that is not a URL is a place to put files. */
export function isEmbedded(url: string): boolean {
  return !/^postgres(ql)?:\/\//.test(url);
}

/**
 * The client, and how many holders it has.
 *
 * The count is what makes a cached client safe to hand out twice. Under `kick
 * dev` two applications overlap for a moment on every save — the reloaded one
 * builds while the previous one shuts down — and they share this map, so a
 * shutdown that simply ended the pool ended the *new* app's connection with
 * it. Every request after a file save then failed with `write
 * CONNECTION_ENDED`, and the fix looked like restarting the dev server.
 *
 * One per URL rather than per application, because sharing is the point: N
 * sites on one instance share one pool (doc 09 §7). An embedded database gets
 * exactly one `pglitePool`: the pool is what hands PGlite's single connection
 * to one caller at a time, and two pools would each think they had it.
 */
const clients = new Map<string, { client: Db; pool: PgPoolLike; holders: number }>();

/** The tables as kickjs-db types them, for `ExpressionBuilder<DbSchema, "…">`. */
export type DbSchema = SchemaToTypes<typeof schema>;
export type Db = KickDbClient<DbSchema>;

/**
 * A connection to the site's database (ADR 0050, ADR 0052).
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
export function createDb(url: string): Db {
  let held = clients.get(url);
  if (!held) {
    const pool = isEmbedded(url)
      ? pglitePool(embeddedFor(url))
      : new pg.Pool({ connectionString: url, max: 10 });
    const client = createDbClient({
      schema,
      dialect: pgDialect({ pool }),
      casing: "snake_case",
      plugins: [safeNullComparison()],
    }) as Db;
    held = { client, pool, holders: 0 };
    clients.set(url, held);
  }
  held.holders += 1;
  return held.client;
}

/**
 * Let go of one holder's client, closing its pool only when nobody is left.
 *
 * What an application calls on shutdown. `closeAllPools` stays for tests and
 * for the end of the process, where "nobody else can be using it" is true by
 * construction. The embedded instance outlives its pool: it is the database.
 */
export async function releaseDb(url: string): Promise<void> {
  const held = clients.get(url);
  if (!held) return;
  held.holders -= 1;
  if (held.holders > 0) return;
  clients.delete(url);
  if (!isEmbedded(url)) await held.pool.end?.();
}

/** For tests and graceful shutdown. */
export async function closeAllPools(): Promise<void> {
  const open = [...clients.entries()];
  clients.clear();
  await Promise.all(open.map(([url, held]) => (isEmbedded(url) ? undefined : held.pool.end?.())));
}

/** A row as read back. Text columns are `string`; narrow them where they are read. */
type Row<T extends keyof DbSchema> = Selectable<DbSchema[T]>;

export type OrganizationRow = Row<"organizations">;
export type SiteRow = Row<"sites">;
export type SiteSpecRow = Row<"site_specs">;
export type SpecPatchRow = Row<"spec_patches">;
export type EntryRow = Row<"entries">;
export type AssetRow = Row<"assets">;
export type OwnerRow = Row<"owners">;
export type OwnerSessionRow = Row<"owner_sessions">;
export type LoginAttemptRow = Row<"login_attempts">;
export type VisitorRow = Row<"visitors">;
export type VisitorSessionRow = Row<"visitor_sessions">;
export type VisitorSaveRow = Row<"visitor_saves">;
export type PaymentRow = Row<"payments">;
export type NewPaymentRow = Insertable<DbSchema["payments"]>;
export type WorkflowRunRow = Row<"workflow_runs">;
export type FlowSessionRow = Row<"flow_sessions">;
