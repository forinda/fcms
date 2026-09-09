/**
 * `fcms init` — a project you can already run.
 *
 * Every other command in this CLI assumes a directory that looks a certain way:
 * `site.yaml` at the root, content types in `content/`, pages in `pages/`, rows
 * in `data/`. That shape was documented and never generated, so a first
 * afternoon began with reading about a layout and typing it out — which is the
 * part of any tool people give up during.
 *
 * The files come from a **starter spec** printed by the same canonical printer
 * `fcms fmt` uses, so a fresh project is already formatted, already valid, and
 * `fmt --check` is silent on it. A scaffold that its own tools then rewrite
 * teaches the wrong thing on the first command.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { splitFiles } from "@forinda-cms/lang";
import { SiteSpec, STARTERS, starterFor } from "@forinda-cms/spec";

import { bold, dim, green, red } from "./report.js";

/** The version the generated `package.json` asks for. Replaced by the bundler. */
declare const __FCMS_VERSION__: string | undefined;
const VERSION = typeof __FCMS_VERSION__ === "string" ? __FCMS_VERSION__ : "latest";

export interface InitOptions {
  readonly starter?: string;
  readonly name?: string;
  readonly force?: boolean;
}

export function init(root: string, options: InitOptions = {}): number {
  const key = options.starter ?? "bookings";
  const starter = starterFor(key);
  if (!starter) {
    console.error(`${red("no such starter")} ${bold(key)}`);
    console.error(dim(`  try one of: ${STARTERS.map((s) => s.key).join(", ")}`));
    return 1;
  }

  const target = resolve(root);
  const name = options.name ?? basename(target);

  // A directory with work in it is somebody's project, and `init` is not a
  // command anybody expects to lose files to. `node_modules` and a `.git` do
  // not count — scaffolding into a freshly cloned or npm-installed directory is
  // the normal case, not the dangerous one.
  const occupied = existsSync(target)
    ? readdirSync(target).filter((entry) => entry !== "node_modules" && entry !== ".git")
    : [];
  if (occupied.length > 0 && options.force !== true) {
    console.error(`${red("not empty")} ${bold(target)} already has ${occupied.length} entries.`);
    console.error(dim("  pick an empty directory, or pass --force if you meant this one."));
    return 1;
  }

  const spec = SiteSpec.parse(starter.build(name));
  const files: Record<string, string> = {
    ...splitFiles(spec),
    "package.json": packageJson(name),
    ".gitignore": gitignore(),
    ".mcp.json": mcpJson(),
    "README.md": readme(name),
  };

  for (const [path, text] of Object.entries(files)) {
    const full = join(target, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text, "utf8");
  }

  console.log(`${green("created")} ${bold(name)} ${dim(`— ${Object.keys(files).length} files`)}`);
  console.log(dim(`  ${starter.label}`));
  console.log();
  console.log(bold("next"));
  console.log(`  npm install`);
  console.log(`  npm run dev            ${dim("# look at it — no server, no database")}`);
  console.log(`  npm start              ${dim("# run it for real, database included")}`);
  console.log();
  console.log(dim("  then `npx fcms link <url>`, `npx fcms login`, `npx fcms apply`."));
  return 0;
}

function basename(path: string): string {
  const last = path.split(/[\\/]/).filter(Boolean).pop() ?? "site";
  // A directory name is a directory name; a site name is a title. `my-hotel`
  // reads badly as a heading, and this is the heading.
  return last.replaceAll(/[-_]+/g, " ").replaceAll(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
}

function packageJson(name: string): string {
  return `${JSON.stringify(
    {
      name:
        name
          .toLowerCase()
          .replaceAll(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "site",
      private: true,
      type: "module",
      scripts: {
        dev: "fcms dev",
        validate: "fcms validate",
        fmt: "fcms fmt",
        plan: "fcms plan",
        apply: "fcms apply",
        start: "forinda-cms",
      },
      devDependencies: {
        "@forinda/fcms-cli": `^${VERSION}`,
        "@forinda/fcms-core": `^${VERSION}`,
      },
    },
    null,
    2,
  )}\n`;
}

function gitignore(): string {
  return `node_modules/
media/

# The embedded database. It is data, not source — back it up, do not commit it.
.fcms/

# \`fcms link\` writes fcms.json, and it IS committed: it names the server this
# directory publishes to and holds no secret. The token lives in your home
# directory, 0600, and never here.
`;
}

function mcpJson(): string {
  return `${JSON.stringify(
    { mcpServers: { fcms: { command: "npx", args: ["-y", "@forinda/fcms-mcp"] } } },
    null,
    2,
  )}\n`;
}

function readme(name: string): string {
  return `# ${name}

A [forinda-cms](https://forinda-cms.netlify.app) site. The whole thing is the
YAML in this directory.

\`\`\`sh
npm install
npm run dev          # localhost:4321, reloads on save, needs nothing else
\`\`\`

| | |
|---|---|
| \`site.yaml\` | name, theme, header and footer, integrations |
| \`content/\` | one content type per file |
| \`pages/\` | one page per file |
| \`data/\` | rows, if you keep any in version control |

## Running it for real

\`\`\`sh
OWNER_EMAIL=you@example.com OWNER_PASSWORD=a-password-of-at-least-12-characters \\
  npm start
\`\`\`

Postgres runs inside the process and keeps its data in \`.fcms\`, so there is
nothing to install. Point \`DATABASE_URL\` at a server when you outgrow one
process — same schema, same migrations.

## Publishing a change

\`\`\`sh
npx fcms validate    # is it valid, and what routes does it have
npx fcms plan        # what applying would change
npx fcms apply       # do it — destructive changes need --yes
\`\`\`
`;
}
