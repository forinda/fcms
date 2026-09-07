/**
 * Connections.
 *
 * One pool per connection URL, cached (doc 09 §7), so N sites on one instance
 * share one pool rather than opening N. Fifteen lines that avoid the obvious
 * bug.
 */
import { drizzle } from "drizzle-orm/postgres-js";
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

export function createDb(url: string) {
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
