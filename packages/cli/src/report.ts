/**
 * Terminal output.
 *
 * ADR 0006 accepted YAML knowing its parse errors are poor, on one condition:
 * failures are reported at the node level with path, line and column. This is
 * the last mile of that promise — a good diagnostic is worth little if it prints
 * as a stack trace.
 */
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import type { Diagnostic } from '@forinda-cms/lang'

const useColor = process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined
const c = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)

export const red = c('31')
export const yellow = c('33')
export const green = c('32')
export const dim = c('2')
export const bold = c('1')

/** Print the offending line with a caret under it, the way a compiler does. */
function excerpt(root: string, d: Diagnostic): string[] {
  if (!d.file || d.line === undefined) return []
  try {
    const lines = readFileSync(`${root}/${d.file}`, 'utf8').split(/\r?\n/)
    const line = lines[d.line - 1]
    if (line === undefined) return []
    const gutter = String(d.line).padStart(4)
    return [
      dim(`${gutter} | `) + line,
      dim('     | ') + ' '.repeat(Math.max((d.col ?? 1) - 1, 0)) + red('^'),
    ]
  } catch {
    return []
  }
}

export function printDiagnostics(root: string, diagnostics: readonly Diagnostic[]): void {
  for (const d of diagnostics) {
    const where = [d.file, d.line, d.col].filter((x) => x !== undefined).join(':')
    console.error(`${red('error')} ${bold(d.message)}`)
    if (where) console.error(dim(`  ${where}`))
    for (const line of excerpt(root, d)) console.error(line)
    if (d.path !== '/') console.error(dim(`  at ${d.path}`))
    if (d.hint) console.error(`  ${yellow('hint')} ${d.hint}`)
    console.error('')
  }
  const n = diagnostics.length
  console.error(red(`${n} ${n === 1 ? 'problem' : 'problems'}`))
}

export function rel(root: string, path: string): string {
  return relative(root, path) || path
}
