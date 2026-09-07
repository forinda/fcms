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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { siteSpecJsonSchema } from '@forinda-cms/spec'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'schema/site.schema.json')

const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://forinda-cms.dev/schema/site.schema.json',
  title: 'forinda-cms site spec',
  description:
    'The whole spec document. Point an editor at this with a ' +
    '`# yaml-language-server: $schema=` comment; note that the canonical file layout ' +
    'splits a spec across site.yaml, content/, pages/ and logic/, so a single file ' +
    'validates against the matching sub-schema rather than this one.',
  ...siteSpecJsonSchema(),
}

const text = `${JSON.stringify(schema, null, 2)}\n`
const check = process.argv.includes('--check')

if (check) {
  let current: string | undefined
  try {
    current = readFileSync(OUT, 'utf8')
  } catch {
    current = undefined
  }
  if (current !== text) {
    console.error('schema/site.schema.json is out of date — run `pnpm schema`.')
    process.exit(1)
  }
  console.log('schema is current')
} else {
  // Git does not track an empty directory, so a fresh clone has no `schema/`.
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, text, 'utf8')
  console.log(`wrote ${OUT} (${text.length} bytes)`)
}
