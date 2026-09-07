/**
 * The spec every task edits.
 *
 * Deliberately the real `examples/salon` rather than a synthetic fixture: it is
 * ADR 0007 test 1's artifact, so the eval measures the model against a spec a
 * real business would actually run. A minimal hand-tuned spec would flatter the
 * numbers.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { joinFiles } from '@forinda-cms/lang'
import type { SiteSpec } from '@forinda-cms/spec'

export const SALON_DIR = join(import.meta.dirname, '../../../examples/salon')

export function loadSalonSpec(dir: string = SALON_DIR): SiteSpec {
  const files: Record<string, string> = { 'site.yaml': readFileSync(join(dir, 'site.yaml'), 'utf8') }

  for (const section of ['content', 'pages', 'logic']) {
    const path = join(dir, section)
    try {
      if (!statSync(path).isDirectory()) continue
    } catch {
      continue
    }
    for (const name of readdirSync(path).filter((f) => f.endsWith('.yaml'))) {
      files[`${section}/${name}`] = readFileSync(join(path, name), 'utf8')
    }
  }

  const joined = joinFiles(files)
  if (!joined.ok) {
    throw new Error(`the salon fixture does not validate:\n${joined.diagnostics.map((d) => d.message).join('\n')}`)
  }
  return joined.spec
}
