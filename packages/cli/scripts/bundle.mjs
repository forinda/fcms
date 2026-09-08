/**
 * Bundle `fcms` into something npm can install.
 *
 * During development this package is TypeScript that imports four other
 * workspace packages through `workspace:*`. Neither half survives publication:
 * a registry has no TypeScript loader and no workspace to resolve against. So
 * the workspace half is compiled and inlined, and what ships is one file plus
 * the two real npm dependencies.
 *
 * The three npm dependencies stay external on purpose. They are ordinary
 * packages a registry can install, they are shared with anything else the user
 * has, and inlining them would mean carrying their security updates instead of
 * npm doing it — `zod` alone is two thirds of the bundle when it is inlined.
 */
import { chmodSync, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const out = join(pkg, "dist");
const bin = join(out, "fcms.mjs");

rmSync(out, { recursive: true, force: true });

// The shebang lives here rather than in `src/bin.ts`, because esbuild keeps
// the entry file's own and two of them put the second on line two, where it is
// a syntax error rather than a shebang. One place that writes it, one check
// below that it survived.
const { name, version } = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
const banner = `#!/usr/bin/env node
/**
 * ${name} v${version}
 *
 * Copyright (c) Felix Orinda
 *
 * This source code is licensed under the AGPL-3.0-or-later license found in
 * the LICENSE file in the root directory of this source tree.
 *
 * @license AGPL-3.0-or-later
 */`;

await build({
  entryPoints: [join(pkg, "src/bin.ts")],
  outfile: bin,
  bundle: true,
  platform: "node",
  format: "esm",
  // The floor the rest of the project builds on (ADR 0046). Anything newer
  // gets transpiled away for no reason; anything older is not supported.
  target: "node22",
  // Exactly what `dependencies` declares, and nothing else: a name that is
  // neither external nor resolvable then fails the build rather than the
  // install, which is the point of listing them rather than marking every
  // bare import external.
  external: ["commander", "yaml", "zod"],
  // A map, because a bug report from somebody else's machine is a stack trace
  // and nothing else, and without one it names a line in a bundle nobody has.
  // It embeds the TypeScript of every package compiled in — which is the source
  // this is published from, under a licence that says you may read it.
  sourcemap: true,
  banner: { js: banner },
  // Licence headers in bundled code stay in the bundle. Stripping them is the
  // one thing every licence this depends on agrees you may not do.
  legalComments: "inline",
  logLevel: "warning",
});

if (!existsSync(bin)) {
  console.error("bundle produced no output.");
  process.exit(1);
}

// A check, not a step: the banner writes the shebang, and a bundle whose first
// line is anything else is a file the shell cannot run — which only shows up
// once installed.
if (!readFileSync(bin, "utf8").startsWith("#!")) {
  console.error(
    "bundle has no shebang: `npm install -g` would produce a file the shell cannot run.",
  );
  process.exit(1);
}

// npm sets this on install from the `bin` field, but a tarball inspected or
// vendored by hand should not need it to be run.
chmodSync(bin, 0o755);

console.log(`bundled fcms → dist/fcms.mjs (${Math.round(statSync(bin).size / 1024)} kB)`);
