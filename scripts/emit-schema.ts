#!/usr/bin/env tsx
/**
 * Emit the JSON Schema editors point at.
 *
 * ADR 0006 justified the YAML choice partly on this: *"generate JSON Schema from
 * `packages/spec` in CI; the existing YAML language server gives autocomplete,
 * inline validation and hover docs in VS Code and JetBrains. Doc 11 listed
 * editor support as a real cost of having human authors — this discharges most
 * of it without writing an LSP."*
 *
 * Until the file exists on disk that is a claim rather than a feature. This
 * makes it real, and `--check` in CI keeps it from drifting behind the schema it
 * is generated from — a stale schema file is worse than none, because an editor
 * would confidently accept a spec the parser rejects.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fragmentJsonSchemas } from "@forinda-cms/spec";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "schema");

/**
 * One schema per file the canonical layout writes.
 *
 * The first version emitted only the whole-document schema and pointed editors
 * at it for `site.yaml` — which carries no `content`, so the editor reported the
 * collections as missing and contradicted the parser. That is the "a stale
 * schema is worse than none" failure one step removed: not stale, just aimed at
 * the wrong document.
 */
const TITLES: Record<string, string> = {
  spec: "forinda-cms spec (single file)",
  site: "forinda-cms site.yaml",
  "content-type": "forinda-cms content type",
  page: "forinda-cms page",
  workflow: "forinda-cms workflow",
};

const check = process.argv.includes("--check");
let stale = false;

for (const [name, schema] of Object.entries(fragmentJsonSchemas())) {
  const out = join(OUT_DIR, `${name}.schema.json`);
  const text = `${JSON.stringify(
    {
      $schema: "http://json-schema.org/draft-07/schema#",
      $id: `https://forinda-cms.dev/schema/${name}.schema.json`,
      title: TITLES[name] ?? name,
      ...schema,
    },
    null,
    2,
  )}\n`;

  if (check) {
    let current: string | undefined;
    try {
      current = readFileSync(out, "utf8");
    } catch {
      current = undefined;
    }
    if (current !== text) {
      console.error(`schema/${name}.schema.json is out of date`);
      stale = true;
    }
  } else {
    // Git does not track an empty directory, so a fresh clone has no `schema/`.
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(out, text, "utf8");
    console.log(`wrote schema/${name}.schema.json (${text.length} bytes)`);
  }
}

if (check) {
  if (stale) {
    console.error("run `pnpm schema`");
    process.exit(1);
  }
  console.log("schemas are current");
}
