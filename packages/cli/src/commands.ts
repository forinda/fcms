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
import { readFileSync, watch, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { diffSpecs, summarise, type EntryCounts } from "@forinda-cms/spec";
import { splitFiles } from "@forinda-cms/lang";
import { declaredStatusPage, llmsTxt, renderPage, routes, statusPage } from "@forinda-cms/render";

import { loadProject } from "./project.js";
import { bold, dim, green, printDiagnostics, red, rel, yellow } from "./report.js";

export function validate(root: string): number {
  const loaded = loadProject(root);
  if (!loaded.ok) {
    printDiagnostics(root, loaded.diagnostics);
    return 1;
  }
  const { spec, source } = loaded.project;
  const n = routes(spec, source).length;
  const plural = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`;
  console.log(
    `${green("ok")} ${bold(spec.name)} — ${plural(spec.content.length, "content type", "content types")}, ` +
      `${plural(spec.pages.length, "page", "pages")}, ${plural(n, "route", "routes")}`,
  );
  return 0;
}

/**
 * Rewrite every file in canonical form.
 *
 * `fmt` may move a node into its canonical file — the gofmt bargain ADR 0006
 * took knowingly, and what keeps round-tripping honest rather than approximate.
 */
/**
 * The routes, as pages rather than as rows.
 *
 * A collection page is one page and as many addresses as it has entries, so
 * printing every address means a site's whole catalogue scrolls past on every
 * start. What an author needs is the shape: which pages exist, and roughly how
 * much sits behind each one.
 */
function summariseRoutes(
  spec: Parameters<typeof routes>[0],
  source: Parameters<typeof routes>[1],
): void {
  const all = routes(spec, source);
  const byPage = new Map<string, { path: string; count: number }>();

  for (const route of all) {
    const found = byPage.get(route.page.key);
    if (found) found.count += 1;
    else byPage.set(route.page.key, { path: route.entry ? route.page.path : route.path, count: 1 });
  }

  for (const [, { path, count }] of byPage) {
    console.log(count > 1 ? dim(`  ${path}/…  ${count} pages`) : dim(`  ${path}`));
  }
  console.log(
    dim(`  ${byPage.size} ${byPage.size === 1 ? "page" : "pages"}, ${all.length} addresses`),
  );
}

export function fmt(root: string, check = false): number {
  const loaded = loadProject(root);
  if (!loaded.ok) {
    printDiagnostics(root, loaded.diagnostics);
    return 1;
  }

  const canonical = splitFiles(loaded.project.spec);
  const changed: string[] = [];

  for (const [name, text] of Object.entries(canonical)) {
    let current: string | undefined;
    try {
      current = readFileSync(`${root}/${name}`, "utf8");
    } catch {
      current = undefined;
    }
    if (current === text) continue;
    changed.push(name);
    if (!check) writeFileSync(`${root}/${name}`, text, "utf8");
  }

  if (changed.length === 0) {
    console.log(`${green("ok")} already canonical`);
    return 0;
  }
  if (check) {
    console.error(`${changed.length} file(s) are not canonical:`);
    for (const f of changed) console.error(`  ${f}`);
    return 1;
  }
  console.log(`${green("formatted")} ${changed.length} file(s)`);
  for (const f of changed) console.log(dim(`  ${f}`));
  return 0;
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
  let version = Date.now();
  /** The last failure printed, so a reload poll does not reprint it forever. */
  let printed = "";

  const server = createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0] ?? "/";

    // Long-poll rather than a websocket: a dozen lines, no dependency, and the
    // spike's reload path does not need to be clever.
    if (url === "/__reload") {
      const sent = version;
      const timer = setInterval(() => {
        if (version !== sent) {
          clearInterval(timer);
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("reload");
        }
      }, 200);
      req.on("close", () => clearInterval(timer));
      return;
    }

    const loaded = loadProject(root);
    if (!loaded.ok) {
      // Once per breakage, not once per request. A broken spec plus a browser
      // polling for a reload reprinted the same diagnostics every second, and
      // the error you were trying to read scrolled away as you read it.
      const signature = loaded.diagnostics.map((d) => d.message).join("\n");
      if (signature !== printed) {
        printDiagnostics(root, loaded.diagnostics);
        printed = signature;
      }
      res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
      res.end(errorPage(loaded.diagnostics));
      return;
    }

    // Fixed: the next breakage is news again.
    printed = "";

    const { spec, source } = loaded.project;

    // What the site publishes to machines. The engine served these and `dev`
    // did not, so the one place an author can look at their site before it is
    // live was the one place these could not be checked.
    if (url === "/llms.txt") {
      if (!spec.seo.llms) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(llmsTxt(spec));
      return;
    }

    const all = routes(spec, source);
    const path = url !== "/" && url.endsWith("/") ? url.slice(0, -1) : url;
    const match = all.find((r) => r.path === path);

    if (!match) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      // The site's own 404, in the site's own clothes — and the author's, if
      // they wrote one. A list of every route is a developer's answer to a
      // visitor's question.
      res.end(
        renderPage(declaredStatusPage(spec, 404) ?? statusPage(spec, 404), {
          spec,
          source,
          locale: { locale: spec.locale, currency: spec.currency },
        }).html + LIVE_RELOAD,
      );
      return;
    }

    // `fcms dev` reads files and has no database, so a journey has no state to
    // be part-way through: every step is shown, which is what an author needs
    // while writing one (ADR 0028).
    // The site's own money and dates. The engine passes these and this did not,
    // so a spec saying `currency: USD` rendered shillings under `fcms dev` and
    // dollars once applied — the preview disagreeing with the site is the one
    // thing a preview may not do.
    const { html } = renderPage(
      match.page,
      {
        spec,
        source,
        previewFlows: true,
        locale: { locale: spec.locale, currency: spec.currency },
      },
      match.entry,
    );
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(html + LIVE_RELOAD);
  });

  watch(root, { recursive: true }, (_event, file) => {
    if (file && /\.ya?ml$/.test(String(file))) {
      version = Date.now();
      console.log(dim(`  changed ${String(file)}`));
    }
  });

  // A port already in use is the commonest thing that happens to a dev server,
  // and it arrived as an unhandled exception with a stack trace. Step along
  // rather than stop: the banner prints the port it actually got, which is the
  // only place anybody reads it from anyway.
  let attempt = port;
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code !== "EADDRINUSE" || attempt >= port + 10) {
      console.error(`${red("error")} ${err.message}`);
      process.exit(1);
    }
    console.log(dim(`  port ${attempt} is in use`));
    attempt += 1;
    server.listen(attempt);
  });

  server.listen(port, () => {
    const loaded = loadProject(root);
    if (loaded.ok) summariseRoutes(loaded.project.spec, loaded.project.source);
    else printDiagnostics(root, loaded.diagnostics);

    // Last, so it is the line still on screen. It came first and was then
    // pushed off by the routes — a site with two hundred rooms printed two
    // hundred lines, and the address you actually needed was above all of them.
    console.log(
      `\n${green("dev")} ${bold(`http://localhost:${attempt}`)}  ${dim(rel(process.cwd(), root))}`,
    );
  });
}

const LIVE_RELOAD =
  '<script>(function p(){fetch("/__reload").then(function(r){' +
  "if(r.ok)location.reload();else setTimeout(p,1000)})" +
  ".catch(function(){setTimeout(p,1000)})})();</script>";

function escapeHtml(s: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return s.replace(/[&<>"']/g, (ch) => map[ch]!);
}

function shell(title: string, body: string): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${escapeHtml(title)}</title><style>` +
    "body{font:14px/1.6 ui-monospace,SFMono-Regular,monospace;margin:0;padding:2rem;background:#1a1a1a;color:#e5e5e5}" +
    "h1{font-size:1rem;color:#f87171;margin:0 0 1rem}code{color:#fbbf24}" +
    "li{margin:.4rem 0}a{color:#60a5fa}.hint{color:#fbbf24}" +
    `</style></head><body>${body}${LIVE_RELOAD}</body></html>`
  );
}

function errorPage(
  diagnostics: readonly {
    message: string;
    file?: string;
    line?: number;
    col?: number;
    hint?: string;
  }[],
): string {
  const items = diagnostics
    .map((d) => {
      const where = [d.file, d.line, d.col].filter((x) => x !== undefined).join(":");
      return (
        `<li><strong>${escapeHtml(d.message)}</strong>` +
        (where ? ` <code>${escapeHtml(where)}</code>` : "") +
        (d.hint ? `<div class="hint">hint: ${escapeHtml(d.hint)}</div>` : "") +
        "</li>"
      );
    })
    .join("");
  return shell("Spec error", `<h1>The spec did not validate</h1><ul>${items}</ul>`);
}

/**
 * `fcms diff` — what changed, in the owner's vocabulary.
 *
 * This is the instrument ADR 0007 test 2 needs. The test is "show a real owner
 * five changes and ask what each does", and until now nothing could produce
 * them: a textual diff of YAML is line noise, and doc 13's claim is about
 * *meaning*, not text.
 *
 * Destructive changes print first and loudest. The review question is "is
 * anything about to be lost", and burying that under six renames is how a
 * reviewer says yes to something they did not read.
 */
export function diff(beforeRoot: string, afterRoot: string): number {
  const before = loadProject(beforeRoot);
  if (!before.ok) {
    console.error(`the "before" spec does not load:`);
    printDiagnostics(beforeRoot, before.diagnostics);
    return 1;
  }
  const after = loadProject(afterRoot);
  if (!after.ok) {
    console.error(`the "after" spec does not load:`);
    printDiagnostics(afterRoot, after.diagnostics);
    return 1;
  }

  // Counted from the "before" side: the question is how much existing data a
  // change puts at risk, and that is what exists now.
  const counts: EntryCounts = Object.fromEntries(
    before.project.spec.content.map((t) => [t.key, before.project.source.all(t.key).length]),
  );

  const changes = diffSpecs(before.project.spec, after.project.spec, counts);
  if (changes.length === 0) {
    console.log(`${green("no changes")}`);
    return 0;
  }

  const { total, destructive } = summarise(changes);
  console.log("");
  for (const change of changes) {
    const marker = change.classification === "destructive" ? yellow("!") : green("+");
    console.log(`  ${marker} ${bold(change.summary)}`);
    if (change.impact) console.log(`    ${change.impact}`);
    console.log(dim(`    ${change.path}`));
    console.log("");
  }

  console.log(
    destructive === 0
      ? `${total} ${total === 1 ? "change" : "changes"}, none destructive.`
      : `${total} ${total === 1 ? "change" : "changes"}, ${yellow(`${destructive} destructive`)} — read those first.`,
  );
  // Non-zero when something would be lost, so `fcms diff` can gate a script the
  // way `plan` will in Phase 0b.
  return destructive > 0 ? 2 : 0;
}
