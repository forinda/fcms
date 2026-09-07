/**
 * CLI tests, run against the real `examples/salon` fixture rather than a
 * synthetic one.
 *
 * That is deliberate: the fixture is ADR 0007 test 1's artifact — a real
 * business's spec — so these tests fail if the language stops being able to
 * express it. That is a more useful alarm than a hand-tuned minimal spec, which
 * would keep passing while the real thing broke.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { renderPage, routes } from '@forinda-cms/render'

import { loadProject } from './project.js'

const SALON = join(import.meta.dirname, '../../../examples/salon')

const temps: string[] = []
function copyOfSalon(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fcms-'))
  temps.push(dir)
  cpSync(SALON, dir, { recursive: true })
  return dir
}
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('the salon fixture (ADR 0007 test 1)', () => {
  it('loads and validates', () => {
    const loaded = loadProject(SALON)
    expect(loaded.ok, loaded.ok ? '' : JSON.stringify(loaded.diagnostics, null, 2)).toBe(true)
  })

  it('has the shape a real salon needs', () => {
    const loaded = loadProject(SALON)
    if (!loaded.ok) throw new Error('fixture must load')
    const { spec } = loaded.project
    expect(spec.content.map((t) => t.key).sort()).toEqual(['booking', 'service', 'staff'])
    // The state machine is the part ADR 0009 §4 exists for.
    const status = spec.content.find((t) => t.key === 'booking')!.fields.find((f) => f.name === 'status')!
    expect(status.type).toBe('state')
  })

  it('renders every route it declares', () => {
    const loaded = loadProject(SALON)
    if (!loaded.ok) throw new Error('fixture must load')
    const { spec, source } = loaded.project
    const all = routes(spec, source)
    expect(all.length).toBeGreaterThan(5)
    for (const r of all) {
      const { html } = renderPage(r.page, { spec, source }, r.entry)
      expect(html, r.path).toContain('<!doctype html>')
      // A block the registry does not know renders a visible placeholder, so
      // this catches a fixture using vocabulary that no longer exists.
      expect(html, r.path).not.toContain('Unknown block type')
    }
  })

  it('renders the booking flow as steps without completing one', () => {
    const loaded = loadProject(SALON)
    if (!loaded.ok) throw new Error('fixture must load')
    const { spec, source } = loaded.project
    const book = spec.pages.find((p) => p.key === 'book')!
    const { html } = renderPage(book, { spec, source })
    for (const step of ['service', 'stylist', 'time', 'details']) {
      expect(html).toContain(`data-step="${step}"`)
    }
  })

  it('does not repeat the site name in the home page title', () => {
    const loaded = loadProject(SALON)
    if (!loaded.ok) throw new Error('fixture must load')
    const { spec, source } = loaded.project
    const home = spec.pages.find((p) => p.key === 'home')!
    const { title } = renderPage(home, { spec, source })
    expect(title).toBe('Riverside Salon')
  })
})

describe('diagnostics point at the file the author edits', () => {
  it('names the file, line and column of a schema failure', () => {
    const dir = copyOfSalon()
    const path = join(dir, 'content/service.yaml')
    writeFileSync(path, readFileSync(path, 'utf8').replace('type: number, required: true }', 'type: nummber, required: true }'))

    const loaded = loadProject(dir)
    expect(loaded.ok).toBe(false)
    if (loaded.ok) return
    const d = loaded.diagnostics[0]!
    // Before relocation this reported a line in the re-printed merged document —
    // a position that points at nothing on disk, which is worse than none
    // because it looks authoritative.
    expect(d.file).toBe('content/service.yaml')
    expect(d.line).toBeGreaterThan(0)
    expect(d.path).toContain('fields')
  })

  it('explains an unquoted template rather than complaining about braces', () => {
    const dir = copyOfSalon()
    const path = join(dir, 'pages/home.yaml')
    writeFileSync(path, readFileSync(path, 'utf8').replace('heading: "{{ item.name }}"', 'heading: {{ item.name }}'))

    const loaded = loadProject(dir)
    expect(loaded.ok).toBe(false)
    if (loaded.ok) return
    expect(loaded.diagnostics[0]!.message).toMatch(/must be quoted/)
    expect(loaded.diagnostics[0]!.file).toBe('pages/home.yaml')
  })

  it('says which file is missing when there is no site.yaml', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fcms-'))
    temps.push(dir)
    mkdirSync(join(dir, 'pages'), { recursive: true })
    const loaded = loadProject(dir)
    expect(loaded.ok).toBe(false)
    if (!loaded.ok) expect(loaded.diagnostics[0]!.message).toMatch(/site\.yaml/)
  })
})

describe('entries come from a source the renderer cannot see behind', () => {
  it('reads data/*.yaml in the spike', () => {
    const loaded = loadProject(SALON)
    if (!loaded.ok) throw new Error('fixture must load')
    // The same interface is Postgres-backed in Phase 0b; nothing above it changes.
    expect(loaded.project.source.all('service').length).toBeGreaterThan(0)
    expect(loaded.project.source.all('nonexistent')).toEqual([])
  })
})
