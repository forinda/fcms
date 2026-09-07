/**
 * The deterministic migration planner.
 *
 * This is the machinery ADR 0013 chose Postgres *for*. Mongo's headline benefit
 * was that a runtime content-type change needs no migration — and that is the
 * deletion of a safety feature, because "you are about to drop data 340
 * customers depend on" needs a schema to diff against.
 *
 * So: the spec declares the desired shape, this computes the difference, and
 * every step is classified before anything runs. Additive steps apply on their
 * own; destructive ones need an explicit yes (doc 03).
 *
 * ## Deviation from doc 03 §2: expression indexes, not generated columns
 *
 * Doc 03 said filterable fields "get generated columns plus real indexes". That
 * does not survive contact with a shared `entries` table:
 *
 *   - A generated column is a **table-wide** schema change driven by one site's
 *     spec. Two sites with a `service` type whose `price` is a number in one and
 *     text in the other cannot both be satisfied.
 *   - N sites × M filterable fields is N×M columns on one table, almost all null.
 *
 * A **partial expression index** gives the same query performance, is scoped to
 * one site and type by its `WHERE` clause, and changes no table shape at all. It
 * costs one constraint: the query must use the same expression the index was
 * built on — which is fine, because the query layer generates both from the same
 * field definition.
 */
import { sql } from "drizzle-orm";

import type { Executor } from "./client.js";
import { createHash } from "node:crypto";
import type { ContentType, Field, SiteSpec } from "@forinda-cms/spec";
import type { Classification } from "@forinda-cms/spec";

export interface MigrationStep {
  readonly kind: "create-index" | "drop-index" | "purge-field" | "delete-entries";
  readonly classification: Classification;
  /** One sentence for the confirmation prompt and the audit log. */
  readonly description: string;
  readonly statement: string;
}

/**
 * Identifiers reaching a SQL string.
 *
 * Every one of these comes from a spec validated by `Key` (lowercase kebab) or
 * `FieldName` (camelCase), so they cannot contain a quote — but a schema is a
 * long way from a SQL string, and an assertion here costs nothing while the
 * alternative is an injection through a content-type name.
 */
const SAFE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

function assertSafe(value: string, what: string): string {
  if (!SAFE.test(value)) throw new Error(`unsafe ${what} in a migration: ${JSON.stringify(value)}`);
  return value;
}

/** Deterministic and inside Postgres's 63-character identifier limit. */
export function indexName(siteId: string, typeKey: string, fieldName: string): string {
  const digest = createHash("sha256").update(`${siteId}:${typeKey}:${fieldName}`).digest("hex");
  return `ix_e_${digest.slice(0, 24)}`;
}

/**
 * How a field's JSON value is read for indexing.
 *
 * `->>` always yields text, so anything ordered needs a cast or `10` sorts
 * before `9`. A field whose values will not reliably cast is left as text
 * rather than risking an index build that fails on one bad row.
 */
function indexExpression(field: Field): string {
  const name = assertSafe(field.name, "field name");
  const json = `(data ->> '${name}')`;
  switch (field.type) {
    case "number":
      return `(${json})::numeric`;
    case "boolean":
      return `(${json})::boolean`;
    case "date":
    case "datetime":
      // Text, deliberately. `::timestamptz` is **not IMMUTABLE** — it depends on
      // the session's TimeZone — so Postgres refuses it in an index expression
      // (42P17). ISO-8601 sorts lexicographically in the same order it sorts
      // chronologically, so plain text gives correct ordering for free.
      //
      // The caveat: that holds only while values share a format and offset.
      // Timestamps must therefore be normalised to UTC on write, which they
      // should be regardless — the same gap ADR 0014 recorded for `schedule`.
      return json;
    default:
      return json;
  }
}

const filterable = (f: Field): boolean => "filterable" in f && f.filterable === true;

function fieldsOf(type: ContentType | undefined): Map<string, Field> {
  return new Map((type?.fields ?? []).map((f) => [f.name, f]));
}

export interface PlanScope {
  readonly siteId: string;
}

/**
 * Compute the steps that take the database from `before` to `after`.
 *
 * Every statement is idempotent — `IF NOT EXISTS` / `IF EXISTS` — so a plan that
 * died halfway can simply be re-run. That is the same property provisioning
 * relies on (doc 09 §6), and it is what lets the install artifact migrate on
 * boot rather than asking a self-hoster to reason about state.
 */
export function planMigration(
  before: SiteSpec | undefined,
  after: SiteSpec,
  scope: PlanScope,
): MigrationStep[] {
  const steps: MigrationStep[] = [];
  const siteId = assertSafe(scope.siteId, "site id");
  const beforeTypes = new Map((before?.content ?? []).map((t) => [t.key, t]));
  const afterTypes = new Map(after.content.map((t) => [t.key, t]));

  const where = (typeKey: string) =>
    `site_id = '${siteId}' AND type_key = '${assertSafe(typeKey, "content type key")}'`;

  for (const [typeKey, type] of afterTypes) {
    // A derived type has no stored rows (ADR 0014) — its entries are computed on
    // demand — so indexing it is not merely wasteful, it is indexing a table
    // that will never contain the data. Skipped entirely.
    if (type.derived) continue;

    const wasFields = fieldsOf(beforeTypes.get(typeKey));
    const nowFields = fieldsOf(type);

    for (const [name, field] of nowFields) {
      const was = wasFields.get(name);
      const wasIndexed = was !== undefined && filterable(was) && was.type === field.type;
      if (!filterable(field) || wasIndexed) continue;

      // A type change on an indexed field drops and rebuilds, because the
      // expression itself changed — the old index would answer with the wrong
      // ordering rather than not answer at all.
      if (was && filterable(was) && was.type !== field.type) {
        steps.push({
          kind: "drop-index",
          classification: "additive",
          description: `Rebuilds the index on ${type.label}.${name} because its type changed.`,
          statement: `DROP INDEX IF EXISTS ${indexName(siteId, typeKey, name)}`,
        });
      }

      steps.push({
        kind: "create-index",
        classification: "additive",
        description: `Indexes ${type.label}.${name} so it can be filtered and sorted quickly.`,
        statement:
          `CREATE INDEX IF NOT EXISTS ${indexName(siteId, typeKey, name)} ` +
          // Doubly parenthesised: Postgres requires an index expression that is
          // not a bare column or function call to be wrapped in its own parens,
          // and a cast is neither. `ON entries ((expr))`, not `ON entries (expr)`.
          `ON entries ((${indexExpression(field)})) WHERE ${where(typeKey)}`,
      });
    }

    for (const [name, was] of wasFields) {
      const now = nowFields.get(name);
      if (now === undefined) continue;
      if (filterable(was) && !filterable(now)) {
        steps.push({
          kind: "drop-index",
          classification: "additive",
          description: `Stops indexing ${type.label}.${name}. Values are kept.`,
          statement: `DROP INDEX IF EXISTS ${indexName(siteId, typeKey, name)}`,
        });
      }
    }

    // A removed field: the index goes, and the stored values go only if asked.
    for (const [name, was] of wasFields) {
      if (nowFields.has(name)) continue;
      if (filterable(was)) {
        steps.push({
          kind: "drop-index",
          classification: "additive",
          description: `Stops indexing the removed field ${type.label}.${name}.`,
          statement: `DROP INDEX IF EXISTS ${indexName(siteId, typeKey, name)}`,
        });
      }
      steps.push({
        kind: "purge-field",
        classification: "destructive",
        description: `Deletes the stored ${was.label || name} values from every ${type.label}.`,
        statement: `UPDATE entries SET data = data - '${assertSafe(name, "field name")}' WHERE ${where(typeKey)}`,
      });
    }
  }

  for (const [typeKey, type] of beforeTypes) {
    if (afterTypes.has(typeKey) || type.derived) continue;
    for (const field of type.fields) {
      if (!filterable(field)) continue;
      steps.push({
        kind: "drop-index",
        classification: "additive",
        description: `Stops indexing ${type.label}.${field.name}.`,
        statement: `DROP INDEX IF EXISTS ${indexName(siteId, typeKey, field.name)}`,
      });
    }
    steps.push({
      kind: "delete-entries",
      classification: "destructive",
      description: `Deletes every stored ${type.label} record.`,
      statement: `DELETE FROM entries WHERE ${where(typeKey)}`,
    });
  }

  // Additive first, so an interrupted run leaves the database more capable
  // rather than less: indexes exist before anything is deleted.
  return steps.sort((a, b) =>
    a.classification === b.classification ? 0 : a.classification === "additive" ? -1 : 1,
  );
}

/**
 * Run a plan.
 *
 * Destructive steps are skipped unless allowed, rather than the whole plan
 * failing — the additive half is safe and useful on its own, and a caller that
 * declined a deletion should still get their new index.
 */
export async function runMigration(
  tx: Executor,
  steps: readonly MigrationStep[],
  options: { allowDestructive?: boolean } = {},
): Promise<{ applied: MigrationStep[]; skipped: MigrationStep[] }> {
  const applied: MigrationStep[] = [];
  const skipped: MigrationStep[] = [];

  for (const step of steps) {
    if (step.classification === "destructive" && options.allowDestructive !== true) {
      skipped.push(step);
      continue;
    }
    await tx.execute(sql.raw(step.statement));
    applied.push(step);
  }

  return { applied, skipped };
}
