/**
 * Connections.
 *
 * One pool per connection URL, cached — the pattern from `enaton`
 * (doc 09 §7), where N organizations on one instance shared one pool rather
 * than opening N. Fifteen lines that avoid the obvious bug.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

const pools = new Map<string, postgres.Sql>();

function poolFor(url: string): postgres.Sql {
  let sql = pools.get(url);
  if (!sql) {
    sql = postgres(url, { max: 10, onnotice: () => {} });
    pools.set(url, sql);
  }
  return sql;
}

export function createDb(url: string) {
  return drizzle(poolFor(url), { schema, casing: "snake_case" });
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
  await Promise.all(open.map((sql) => sql.end({ timeout: 5 })));
}
