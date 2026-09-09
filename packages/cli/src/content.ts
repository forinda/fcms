/**
 * `--content` — the rows, not only the shape (ADR 0043).
 *
 * `pull` and `apply` move the spec: what the site is. Everything a business
 * actually accumulates — its bookings, its services, its enquiries — lived only
 * in Postgres, so "your data is yours" was true of the structure and not of the
 * content. A self-hostable product whose content has no export is one you
 * cannot leave.
 *
 * The file shape is the one this repository already authors by hand
 * (`examples/salon/data/*.yaml`): a list per type, each row its fields plus its
 * slug. So an export can be committed, edited and applied, and the fixtures
 * that existed before this were already in the format it writes.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";

import { checkUnquotedTemplates, printSpec, STRICT_PARSE_OPTIONS } from "@forinda-cms/lang";
import type { SiteSpec } from "@forinda-cms/spec";
import type { Client, EntryInput } from "@forinda-cms/sdk";

import { bold, dim, green, red } from "./report.js";

/** Where the rows live, beside `content/`, `pages/` and `logic/`. */
export const DATA_DIR = "data";

/**
 * One row, as a file holds it: its fields, flat, plus at most two controls.
 *
 * The controls are prefixed, and that is not decoration. A booking type
 * declares a field called `status` — pending, confirmed, cancelled — and the
 * *entry* has a publish state also called status. Written flat, one silently
 * became the other. `__` is the same escape the admin's entry form already uses
 * for the same collision, and no field name may contain it.
 *
 * `__id` appears only for a row with no slug — a booking, an enquiry, the
 * things nobody names — because that is the only way an import can find that
 * row again. A file of named things stays free of machine identifiers.
 */
interface FileRow extends Record<string, unknown> {
  slug?: string;
  __id?: string;
  __status?: string;
}

export async function pullContent(root: string, client: Client, spec: SiteSpec): Promise<number> {
  const stored = spec.content.filter((type) => !type.derived);
  let rows = 0;

  for (const type of stored) {
    const entries = await client.entries(type.key);
    const file: FileRow[] = entries
      .map((entry): FileRow => ({
        ...(entry.slug ? { slug: entry.slug } : { __id: entry.id }),
        // Only when it is not the ordinary state, so a file of published rows
        // reads as content rather than as a database dump.
        ...(entry.status === "draft" ? { __status: "draft" } : {}),
        ...entry.data,
      }))
      // Stable, so a second export of an unchanged site is byte-identical and
      // committing one produces no diff.
      .sort((a, b) => String(a.slug ?? a.__id).localeCompare(String(b.slug ?? b.__id)));

    mkdirSync(join(root, DATA_DIR), { recursive: true });
    writeFileSync(join(root, DATA_DIR, `${type.key}.yaml`), printSpec(file), "utf8");
    rows += file.length;
  }

  console.log(
    `${green("pulled")} ${bold(String(rows))} rows ${dim(`— ${stored.length} files in ${DATA_DIR}/`)}`,
  );
  return 0;
}

/**
 * Rows from files, into the site.
 *
 * Matched by `id` where a row has one and by `slug` otherwise; anything that
 * matches nothing is created. **Nothing is ever deleted** — an import is a
 * restore or a merge, and a file that happens not to mention a row is not an
 * instruction to remove it.
 */
export async function pushContent(root: string, client: Client, spec: SiteSpec): Promise<number> {
  const dir = join(root, DATA_DIR);
  let files: string[];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"));
  } catch {
    console.log(dim(`no ${DATA_DIR}/ directory — nothing to send`));
    return 0;
  }

  let created = 0;
  let updated = 0;
  const refused: { file: string; row: string; why: string }[] = [];

  for (const name of files.sort()) {
    const key = name.replace(/\.ya?ml$/, "");
    const type = spec.content.find((t) => t.key === key);
    if (!type) {
      console.error(`${red("skipped")} ${name} ${dim("— this site has no type by that name")}`);
      continue;
    }
    if (type.derived) {
      console.error(`${red("skipped")} ${name} ${dim("— its rows are computed, not stored")}`);
      continue;
    }

    const source = readFileSync(join(dir, name), "utf8");

    // Parsed as plain YAML rather than through `parseSpec`: a data file is a
    // list of rows, not a spec document, and the spec parser rightly refuses
    // one. The strict options come along anyway — 1.2 core so `no` stays a
    // word, duplicate keys an error, no merge keys — because those rules are
    // about YAML being predictable, not about specs.
    const rows = readRows(source, name);
    if (!Array.isArray(rows)) {
      console.error(`${red("failed")} ${name}`);
      console.error(`  ${rows.message}`);
      return 1;
    }

    const existing = await client.entries(type.key);
    const bySlug = new Map(existing.filter((e) => e.slug).map((e) => [e.slug!, e]));
    const byId = new Map(existing.map((e) => [e.id, e]));

    // A type may declare a field called `slug` — most that have addresses do.
    // Then the value belongs in two places: the column the URL reads, and the
    // field the spec declared. The admin's own form does the same thing, and
    // without it every row of such a type is refused for a missing field it
    // plainly has.
    const declaresSlug = type.fields.some((field) => field.name === "slug");

    for (const row of rows) {
      const { slug, __id: id, __status: status, ...rest } = row;
      const data = declaresSlug && slug ? { ...rest, slug } : rest;
      const found = id ? byId.get(id) : slug ? bySlug.get(slug) : undefined;
      const input: EntryInput = {
        data,
        ...(slug ? { slug } : {}),
        // Absent means published, because that is what `pull` means by absent:
        // it writes `__status` only for a draft, so a file of published rows
        // reads as content rather than as a database dump. Reading absent as
        // "draft" instead — the server's default for a new row — made
        // `pull --content` followed by `apply --content` unpublish an entire
        // site in silence, which is a backup that destroys what it restores.
        status: status === "draft" ? "draft" : "published",
      };

      // One row's failure is not the import's. A restore that stops at the
      // first row the site refuses leaves somebody with a half-restored site
      // and no list of what is missing — so every row is attempted and the
      // refusals are reported together.
      try {
        if (found) {
          await client.updateEntry(type.key, found.id, input);
          updated += 1;
        } else {
          await client.createEntry(type.key, input);
          created += 1;
        }
      } catch (error) {
        refused.push({ file: name, row: String(slug ?? id ?? "?"), why: reason(error) });
      }
    }
  }

  console.log(
    `${green("sent")} ${bold(String(created + updated))} rows ${dim(`— ${created} new, ${updated} updated`)}`,
  );
  console.log(dim("  nothing was deleted; a file that omits a row is not an instruction."));

  for (const { file, row, why } of refused) {
    console.error(`${red("refused")} ${file} ${bold(row)} ${dim(`— ${why}`)}`);
  }
  // Non-zero when anything was refused, so a restore in a script does not look
  // like it worked.
  return refused.length > 0 ? 1 : 0;
}

/** What the site said, in one line. */
function reason(error: unknown): string {
  const issues = (error as { issues?: { path?: string; message?: string }[] }).issues;
  if (Array.isArray(issues) && issues.length > 0) {
    return issues.map((i) => `${i.path ?? "?"}: ${i.message ?? ""}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * One data file, as rows.
 *
 * The unquoted-template check runs here too. It exists because a sentence with
 * a comma in it, unquoted, parses as something else entirely — which is how a
 * service's description became a key called "any length." in the first place —
 * and a file being sent back into the site is exactly where that matters.
 */
function readRows(source: string, name: string): FileRow[] | { message: string } {
  for (const issue of checkUnquotedTemplates(source)) {
    return { message: `${issue.message} (line ${issue.line ?? "?"})` };
  }

  let value: unknown;
  try {
    value = parse(source, STRICT_PARSE_OPTIONS);
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    return { message: `${name} should be a list of rows, one per entry.` };
  }
  return value as FileRow[];
}
