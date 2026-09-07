/**
 * Reading a spec directory off disk.
 *
 * The canonical layout is derived from the AST (ADR 0006), so this is the
 * inverse: gather the files a `pull` would have written, plus the entry data
 * the spike keeps beside them.
 *
 *     site.yaml
 *     content/<type>.yaml
 *     pages/<page>.yaml
 *     logic/<flow>.yaml
 *     data/<type>.yaml        ← spike only; Postgres in Phase 0b
 *
 * `data/` is not part of the spec and never will be. ADR 0007 gives the spike no
 * database, but `data` queries still need rows to render, so entries live in
 * files behind the same `EntrySource` interface Postgres will implement. Nothing
 * above that interface knows the difference.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { joinFiles, type Diagnostic } from '@forinda-cms/lang'
import type { SiteSpec } from '@forinda-cms/spec'
import { staticSource, type Entry, type EntrySource } from '@forinda-cms/render'

export interface Project {
  readonly root: string
  readonly spec: SiteSpec
  readonly source: EntrySource
  /** Every file the project reads, for the dev server's watcher. */
  readonly files: readonly string[]
}

function yamlFilesIn(dir: string): string[] {
  try {
    if (!statSync(dir).isDirectory()) return []
  } catch {
    return []
  }
  return readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).map((f) => join(dir, f))
}

export function loadProject(root: string): { ok: true; project: Project } | { ok: false; diagnostics: readonly Diagnostic[] } {
  const files: Record<string, string> = {}
  const read: string[] = []

  const site = join(root, 'site.yaml')
  try {
    files['site.yaml'] = readFileSync(site, 'utf8')
    read.push(site)
  } catch {
    return {
      ok: false,
      diagnostics: [{ path: '/', message: `no site.yaml in ${root}`, hint: 'a spec directory needs site.yaml at its root.' }],
    }
  }

  for (const section of ['content', 'pages', 'logic']) {
    for (const path of yamlFilesIn(join(root, section))) {
      files[relative(root, path).replace(/\\/g, '/').replace(/\.yml$/, '.yaml')] = readFileSync(path, 'utf8')
      read.push(path)
    }
  }

  const joined = joinFiles(files)
  if (!joined.ok) return { ok: false, diagnostics: joined.diagnostics }

  // Entries. Parsed as plain YAML — they are rows, not spec, so the spec schema
  // has nothing to say about them.
  const data: Record<string, Entry[]> = {}
  for (const path of yamlFilesIn(join(root, 'data'))) {
    const type = path.replace(/.*\//, '').replace(/\.ya?ml$/, '')
    const parsed: unknown = parseYaml(readFileSync(path, 'utf8'))
    data[type] = Array.isArray(parsed) ? (parsed as Entry[]) : []
    read.push(path)
  }

  return { ok: true, project: { root, spec: joined.spec, source: staticSource(data), files: read } }
}
