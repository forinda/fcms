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
 * `npm pack`.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const out = resolve(here, "..");

const parts = [
  {
    from: join(root, "apps/engine/dist"),
    to: join(out, "dist"),
    what: "the server",
    // The sourcemap beside the bundle embeds `sourcesContent` — every
    // TypeScript file in this repository, verbatim.
    //
    // Kept out until the repository is actually public, not until the licence
    // says it will be (ADR 0048 §5): the licence is a file in a commit, and
    // the repository being public is an action in a settings page. Until that
    // action is taken, a published map is a leak. Once it is taken this
    // exclusion protects nothing and costs production stack traces their line
    // numbers, and it comes out.
    skip: (name) => name.endsWith(".map"),
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
  cpSync(part.from, part.to, {
    recursive: true,
    ...(part.skip ? { filter: (from) => !part.skip(from) } : {}),
  });
  console.log(`packed ${part.what} → ${part.to.replace(`${out}/`, "")}`);
}

// Belt and braces, because the cost of getting this wrong is the source of the
// product sitting on a CDN forever: nothing shipped may be a sourcemap.
const leaked = readdirSync(join(out, "dist"), { recursive: true }).filter((name) =>
  String(name).endsWith(".map"),
);
if (leaked.length > 0) {
  console.error(`refusing to pack: ${leaked.join(", ")} would publish the source.`);
  process.exit(1);
}
