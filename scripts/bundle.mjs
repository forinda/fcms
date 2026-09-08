/**
 * Bundle a package into something npm can install.
 *
 * `packages/cli` and `packages/mcp` are both TypeScript that imports workspace
 * packages through `workspace:*`. Neither half survives publication: a registry
 * has no TypeScript loader and no workspace to resolve against. So the
 * workspace half is compiled and inlined, and what ships is one file plus the
 * real npm dependencies.
 *
 * Those stay external on purpose. They are ordinary packages a registry can
 * install, they are shared with anything else the user has, and inlining them
 * would mean carrying their security updates instead of npm doing it — `zod`
 * alone was two thirds of the CLI bundle when it was inlined.
 *
 * Nothing here is configured twice: the entry point comes from `bin`, the
 * externals from `dependencies`, and the version from the manifest. A package
 * that publishes a binary needs to say so once.
 *
 *   node ../../scripts/bundle.mjs        # from the package directory
 *
 * `esbuild` is the root's devDependency rather than each package's: this file
 * is what imports it, and Node resolves that from here, not from whichever
 * package happens to be the working directory.
 */
import { chmodSync, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { build } from "esbuild";

const pkg = process.cwd();
const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));

const bins = Object.entries(manifest.publishConfig?.bin ?? manifest.bin ?? {});
if (bins.length !== 1) {
  console.error(`expected exactly one \`bin\`, found ${bins.length}.`);
  process.exit(1);
}
const [, outRelative] = bins[0];
const out = resolve(pkg, outRelative);
const entry = join(pkg, "src/bin.ts");

// Everything in `dependencies`, and nothing else: a name that is neither
// external nor resolvable then fails the build rather than the install, which
// is the point of listing them rather than marking every bare import external.
const external = Object.keys(manifest.dependencies ?? {});

// The shebang is written here, and the entry file's own is stripped below,
// because esbuild keeps whatever the entry starts with — two of them put the
// second on line two, where it is a syntax error rather than a shebang. That
// bug shipped once and was only visible after installing the tarball, so the
// rule is enforced rather than remembered: one writer, one stripper, and a
// check at the end that exactly one survived.
const banner = `#!/usr/bin/env node
/**
 * ${manifest.name} v${manifest.version}
 *
 * Copyright (c) Felix Orinda
 *
 * This source code is licensed under the AGPL-3.0-or-later license found in
 * the LICENSE file in the root directory of this source tree.
 *
 * @license AGPL-3.0-or-later
 */`;

rmSync(dirname(out), { recursive: true, force: true });

await build({
  entryPoints: [entry],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  // The floor the rest of the project builds on. Anything newer gets
  // transpiled away for no reason; anything older is not supported.
  target: "node22",
  external,
  banner: { js: banner },
  plugins: [
    {
      name: "strip-entry-shebang",
      setup(build) {
        build.onLoad({ filter: /\/src\/bin\.ts$/ }, ({ path }) => ({
          contents: readFileSync(path, "utf8").replace(/^#![^\n]*\n/, ""),
          loader: "ts",
        }));
      },
    },
  ],
  // A map, because a bug report from somebody else's machine is a stack trace
  // and nothing else, and without one it names a line in a bundle nobody has.
  sourcemap: true,
  // Licence headers in bundled code stay in the bundle. Stripping them is the
  // one thing every licence this depends on agrees you may not do.
  legalComments: "inline",
  logLevel: "warning",
});

if (!existsSync(out)) {
  console.error("bundle produced no output.");
  process.exit(1);
}

const lines = readFileSync(out, "utf8").split("\n");
if (!lines[0].startsWith("#!")) {
  console.error("bundle has no shebang: `npm install -g` would produce a file the shell cannot run.");
  process.exit(1);
}
if (lines[1]?.startsWith("#!")) {
  console.error("bundle has two shebangs: the second is a syntax error, not a shebang.");
  process.exit(1);
}

// npm sets this on install from the `bin` field, but a tarball inspected or
// vendored by hand should not need it to be run.
chmodSync(out, 0o755);

console.log(
  `bundled ${basename(out)} → ${outRelative} (${Math.round(statSync(out).size / 1024)} kB)`,
);
