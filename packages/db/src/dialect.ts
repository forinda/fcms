/**
 * The one place that knows which database this is.
 *
 * ADR 0049: the product should run in one place with no service to rent, which
 * means SQLite by default and Postgres when a business outgrows it. Two
 * dialects only stay affordable if the difference lives in exactly one file —
 * a `if (sqlite)` in a repository is the data layer leaking upward, and two
 * half-abstracted dialects are worse than one concrete one.
 *
 * So everything above `packages/db` is written against Drizzle's query builder
 * and these helpers, and names no dialect at all. The check is mechanical:
 *
 *     grep -r "pg-core\|sqlite-core" apps packages --include="*.ts" \
 *       | grep -v "^packages/db/"
 *
 * must return nothing, and a lint rule enforces it.
 *
 * What is here is only what genuinely differs. Drizzle already covers columns,
 * joins, `where`, ordering and paging; JSON access, case-insensitive matching,
 * server time and queue claiming it does not.
 */
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

export type DialectName = "postgres" | "sqlite";

export interface Dialect {
  readonly name: DialectName;

  /** A JSON field, as text. `data ->> 'price'`. */
  jsonText(column: SQLWrapper, field: string): SQL;

  /**
   * A JSON field, as a number, for ordering and comparison.
   *
   * Without the cast `10` sorts before `9`, which is the bug this exists to
   * prevent rather than a nicety.
   */
  jsonNumber(column: SQLWrapper, field: string): SQL;

  /** One JSON field replaced, the rest of the document untouched. */
  jsonSet(column: SQLWrapper, field: string, value: unknown): SQL;

  /** Matching that ignores case, because a visitor's search does. */
  likeInsensitive(expression: SQL, pattern: string): SQL;

  /**
   * The database's clock, never the application's.
   *
   * Time belongs to the database: two processes on two machines disagree about
   * `new Date()`, and a queue that reads its own clock runs jobs early.
   */
  now(): SQL;

  /** A moment `seconds` from the database's now, for scheduling. */
  after(seconds: number): SQL;

  /**
   * The lock a queue takes on the rows it claims, if the dialect has one.
   *
   * Postgres: `FOR UPDATE SKIP LOCKED`, so two runners take different rows.
   * SQLite: nothing, because one writer is the whole concurrency model — the
   * rows cannot be claimed twice, since nothing else can be writing.
   */
  claimLock(): SQL | undefined;
}

/** A JSON path expression, escaped once, in the one place that builds them. */
function path(field: string): string {
  // A field name reaching SQL from a spec is a field name an author wrote, so
  // it is checked rather than trusted — the same rule the planner applies to
  // index expressions.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) {
    throw new Error(`unsafe field name in a JSON path: ${JSON.stringify(field)}`);
  }
  return field;
}

export const postgres: Dialect = {
  name: "postgres",

  jsonText: (column, field) => sql`${column} ->> ${path(field)}`,

  jsonNumber: (column, field) => sql`(${column} ->> ${path(field)})::numeric`,

  jsonSet: (column, field, value) =>
    sql`jsonb_set(${column}, ${`{${path(field)}}`}::text[], ${JSON.stringify(value)}::jsonb, true)`,

  likeInsensitive: (expression, pattern) => sql`${expression} ilike ${pattern}`,

  now: () => sql`now()`,

  after: (seconds) => sql`now() + make_interval(secs => ${seconds})`,

  claimLock: () => sql`for update skip locked`,
};

export const sqlite: Dialect = {
  name: "sqlite",

  jsonText: (column, field) => sql`json_extract(${column}, ${`$.${path(field)}`})`,

  // `+ 0` is SQLite's numeric coercion. A value that is not a number becomes
  // `0` rather than an error, which is the same tradeoff Postgres' cast makes
  // in the other direction — there, a bad row fails the index build.
  jsonNumber: (column, field) => sql`(json_extract(${column}, ${`$.${path(field)}`}) + 0)`,

  jsonSet: (column, field, value) =>
    sql`json_set(${column}, ${`$.${path(field)}`}, json(${JSON.stringify(value)}))`,

  // SQLite's `like` is already case-insensitive for ASCII. `lower()` on both
  // sides makes it so for everything else, and costs an index that would not
  // have been used by a leading-wildcard match anyway.
  likeInsensitive: (expression, pattern) => sql`lower(${expression}) like ${pattern.toLowerCase()}`,

  now: () => sql`datetime('now')`,

  after: (seconds) => sql`datetime('now', ${`+${seconds} seconds`})`,

  // Nothing to lock against: one writer at a time is SQLite's model, so a row
  // cannot be claimed twice. This is the ceiling ADR 0049 asks us to say out
  // loud rather than a gap in the implementation.
  claimLock: () => undefined,
};

/**
 * Which dialect a URL asks for.
 *
 * The URL says which it is, so there is no second variable to get wrong: a
 * `postgres://` is Postgres and anything else is a path to a file.
 */
export function dialectFor(url: string): Dialect {
  return /^postgres(ql)?:\/\//.test(url) ? postgres : sqlite;
}
