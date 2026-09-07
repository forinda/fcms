/**
 * The Phase 0a command set.
 *
 * ADR 0002 scopes the CLI to a *management* surface (Netlify-shaped) rather than
 * a scripting one (WP-CLI-shaped), and Phase 0a needs only the three commands
 * that work without a server. `login`, `link`, `pull`, `plan` and `apply` arrive
 * with Phase 0b, when there is something to talk to.
 *
 * Bulk content verbs are deliberately absent and stay absent: doc 11 §2 argues
 * that a scriptable CLI *and* an MCP server means two machine doors to keep in
 * sync, for one audience. MCP is the machine door.
 */
import { readFileSync, watch, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { splitFiles } from '@forinda-cms/lang'
import { renderPage, routes } from '@forinda-cms/render'

import { loadProject } from './project.js'
import { bold, dim, green, printDiagnostics, rel } from './report.js'

export function validate(root: string): number {
  const loaded = loadProject(root)
  if (!loaded.ok) {
    printDiagnostics(root, loaded.diagnostics)
    return 1
  }
  const { spec, source } = loaded.project
  const n = routes(spec, source).length
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  console.log(
    `${green('ok')} ${bold(spec.name)} — ${plural(spec.content.length, 'content type', 'content types')}, ` +
      `${plural(spec.pages.length, 'page', 'pages')}, ${plural(n, 'route', 'routes')}`,
  )
  return 0
}

/**
 * Rewrite every file in canonical form.
 *
 * `fmt` may move a node into its canonical file — the gofmt bargain ADR 0006
 * took knowingly, and what keeps round-tripping honest rather than approximate.
 */
export function fmt(root: string, check = false): number {
  const loaded = loadProject(root)
  if (!loaded.ok) {
    printDiagnostics(root, loaded.diagnostics)
    return 1
  }

  const canonical = splitFiles(loaded.project.spec)
  const changed: string[] = []

  for (const [name, text] of Object.entries(canonical)) {
    let current: string | undefined
    try {
      current = readFileSync(`${root}/${name}`, 'utf8')
    } catch {
      current = undefined
    }
    if (current === text) continue
    changed.push(name)
    if (!check) writeFileSync(`${root}/${name}`, text, 'utf8')
  }

  if (changed.length === 0) {
    console.log(`${green('ok')} already canonical`)
    return 0
  }
  if (check) {
    console.error(`${changed.length} file(s) are not canonical:`)
    for (const f of changed) console.error(`  ${f}`)
    return 1
  }
  console.log(`${green('formatted')} ${changed.length} file(s)`)
  for (const f of changed) console.log(dim(`  ${f}`))
  return 0
}

/**
 * `fcms dev` — the spike made visible.
 *
 * ADR 0007 promoted this from optional on one argument: asking an owner to
 * review a diff of something they have never seen is asking them to read
 * specification; asking them to review it beside the running site is asking them
 * to do their job. Test 2 needs the second situation.
 *
 * Reloads the project on every request rather than caching. The renderer is
 * deterministic and a spec is small, so a cache would only add a way to serve
 * stale HTML to someone trying to see their edit.
 */
export function dev(root: string, port: number): void {
  let version = Date.now()

  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0] ?? '/'

    // Long-poll rather than a websocket: a dozen lines, no dependency, and the
    // spike's reload path does not need to be clever.
    if (url === '/__reload') {
      const sent = version
      const timer = setInterval(() => {
        if (version !== sent) {
          clearInterval(timer)
          res.writeHead(200, { 'content-type': 'text/plain' })
          res.end('reload')
        }
      }, 200)
      req.on('close', () => clearInterval(timer))
      return
    }

    const loaded = loadProject(root)
    if (!loaded.ok) {
      printDiagnostics(root, loaded.diagnostics)
      res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' })
      res.end(errorPage(loaded.diagnostics))
      return
    }

    const { spec, source } = loaded.project
    const all = routes(spec, source)
    const path = url !== '/' && url.endsWith('/') ? url.slice(0, -1) : url
    const match = all.find((r) => r.path === path)

    if (!match) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
      res.end(notFoundPage(all.map((r) => r.path)))
      return
    }

    const { html } = renderPage(match.page, { spec, source }, match.entry)
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(html + LIVE_RELOAD)
  })

  watch(root, { recursive: true }, (_event, file) => {
    if (file && /\.ya?ml$/.test(String(file))) {
      version = Date.now()
      console.log(dim(`  changed ${String(file)}`))
    }
  })

  server.listen(port, () => {
    console.log(`${green('dev')} ${bold(`http://localhost:${port}`)}  ${dim(rel(process.cwd(), root))}`)
    const loaded = loadProject(root)
    if (loaded.ok) {
      for (const r of routes(loaded.project.spec, loaded.project.source)) console.log(dim(`  ${r.path}`))
    } else {
      printDiagnostics(root, loaded.diagnostics)
    }
  })
}

const LIVE_RELOAD =
  '<script>(function p(){fetch("/__reload").then(function(r){' +
  'if(r.ok)location.reload();else setTimeout(p,1000)})' +
  '.catch(function(){setTimeout(p,1000)})})();</script>'

function escapeHtml(s: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return s.replace(/[&<>"']/g, (ch) => map[ch]!)
}

function shell(title: string, body: string): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${escapeHtml(title)}</title><style>` +
    'body{font:14px/1.6 ui-monospace,SFMono-Regular,monospace;margin:0;padding:2rem;background:#1a1a1a;color:#e5e5e5}' +
    'h1{font-size:1rem;color:#f87171;margin:0 0 1rem}code{color:#fbbf24}' +
    'li{margin:.4rem 0}a{color:#60a5fa}.hint{color:#fbbf24}' +
    `</style></head><body>${body}${LIVE_RELOAD}</body></html>`
  )
}

function errorPage(
  diagnostics: readonly { message: string; file?: string; line?: number; col?: number; hint?: string }[],
): string {
  const items = diagnostics
    .map((d) => {
      const where = [d.file, d.line, d.col].filter((x) => x !== undefined).join(':')
      return (
        `<li><strong>${escapeHtml(d.message)}</strong>` +
        (where ? ` <code>${escapeHtml(where)}</code>` : '') +
        (d.hint ? `<div class="hint">hint: ${escapeHtml(d.hint)}</div>` : '') +
        '</li>'
      )
    })
    .join('')
  return shell('Spec error', `<h1>The spec did not validate</h1><ul>${items}</ul>`)
}

function notFoundPage(paths: readonly string[]): string {
  const items = paths.map((p) => `<li><a href="${escapeHtml(p)}">${escapeHtml(p)}</a></li>`).join('')
  return shell('Not found', `<h1>No page answers that path</h1><ul>${items}</ul>`)
}
