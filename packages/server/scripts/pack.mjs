/**
 * Assemble the distributable (ADR 0046).
 *
 * Three things the engine needs at runtime that are not in its bundle: the
 * migrations, the admin application, and a launcher. They live in three
 * different workspace packages during development and in one directory once
 * published, so this is the step that makes those the same thing.
 *
 * Deliberately a copy rather than a workspace dependency: what gets published
 * has to work on a machine with no workspace, and `file:` links do not survive
 * a pack.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const out = resolve(here, "..");

const parts = [
  {
    from: join(root, "apps/engine/dist"),
    to: join(out, "dist"),
    // Including the sourcemap. It embeds `sourcesContent` — every TypeScript
    // file the bundle was built from — which was the reason to exclude it while
    // the source was private, and is the reason to ship it now that the source
    // is public and AGPL. A stack trace from somebody else's server is the only
    // report we get of a bug we cannot reproduce, and without the map it names
    // a line in a bundle nobody has.
    what: "the server",
  },
  {
    from: join(root, "packages/db/migrations"),
    to: join(out, "migrations"),
    what: "the migrations",
  },
  {
    from: join(root, "apps/admin/dist/client"),
    to: join(out, "app"),
    what: "the admin application",
  },
];

for (const part of parts) {
  if (!existsSync(part.from)) {
    console.error(`missing ${part.what}: ${part.from}`);
    console.error("run `pnpm build` at the repository root first.");
    process.exit(1);
  }
  rmSync(part.to, { recursive: true, force: true });
  mkdirSync(dirname(part.to), { recursive: true });
  cpSync(part.from, part.to, { recursive: true });
  console.log(`packed ${part.what} → ${part.to.replace(`${out}/`, "")}`);
}

/**
 * Sign the bundle.
 *
 * `kick build` has no banner option, so the header goes on afterwards — which
 * would silently move every line the sourcemap points at. A map's `mappings`
 * field is one group per line separated by `;`, so one leading `;` per line
 * added puts it back. Getting this wrong is worse than having no banner: a
 * stack trace that is confidently off by six lines.
 */
const pkg = JSON.parse(readFileSync(join(out, "package.json"), "utf8"));
const banner = `/**
 * ${pkg.name} v${pkg.version}
 *
 * Copyright (c) Felix Orinda
 *
 * This source code is licensed under the AGPL-3.0-or-later license found in
 * the LICENSE file in the root directory of this source tree.
 *
 * @license AGPL-3.0-or-later
 */
`;

const bundle = join(out, "dist/index.js");
writeFileSync(bundle, banner + readFileSync(bundle, "utf8"));

const mapPath = `${bundle}.map`;
if (existsSync(mapPath)) {
  const map = JSON.parse(readFileSync(mapPath, "utf8"));
  map.mappings = ";".repeat(banner.split("\n").length - 1) + map.mappings;
  writeFileSync(mapPath, JSON.stringify(map));
}

console.log(`signed dist/index.js — ${pkg.name} v${pkg.version}`);
