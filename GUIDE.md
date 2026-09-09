# Building a site

From nothing to a site you can publish to, in the order you actually do it.
Every command here was run while building the reference marketplace, so if
something below is wrong it is a bug in this file.

## 1. Start a project

```sh
npx @forinda/fcms-cli init my-site && cd my-site
npm install
```

Use whatever you already use — `pnpm dlx`, `yarn dlx`, `bunx` all work, and the
next steps it prints come back in that manager's own commands.

`init` writes a site that already validates, is already canonical (so
`fmt --check` is silent on it), and comes with a `package.json`, a `.gitignore`
that keeps the database out of version control, and an `.mcp.json` with no
machine-specific path in it.

```
site.yaml           name, theme, header and footer, integrations
content/*.yaml      one content type per file
pages/*.yaml        one page per file
data/*.yaml         rows, for seeding or for version-controlled content
```

`--starter <key>` picks what to start from, `--name` sets the site's name when
the directory's is not it, and `--force` scaffolds into a directory that already
has files.

## 2. Run a server

```sh
OWNER_EMAIL=you@example.com \
OWNER_PASSWORD=a-password-of-at-least-12-characters \
PORT=4711 \
npm start
```

That is everything. **Postgres runs inside the process** — the real thing,
compiled to WebAssembly — and keeps its data in `./.fcms`. Nothing to install,
nothing listening but the site itself, and a backup is `cp -r .fcms`.

It migrates on boot and creates the first owner once. Booting again changes
nothing, so this is safe under a process manager.

Two things to know before you rely on it:

- **One connection, and one process.** The embedded database serves one query
  at a time, and belongs to one server at a time — a second one on the same
  directory is refused, because two would corrupt it permanently. For a
  business taking bookings that is invisible; under real traffic it is a
  ceiling, and the way past it is below.
- **Sizes.** About 26 MB installed, and about 40 MB for an empty site's data
  directory.

When you outgrow it — or already have a Postgres — it is one variable. Same
schema and same migrations, so moving is `pg_dump` and nothing else:

```sh
DATABASE_URL=postgres://user:pass@localhost:5432/my_site npx forinda-cms
```

A `postgres://` URL is a server; anything else is a directory to keep files in.
`npx forinda-cms --help` lists every variable it reads — `PORT` (8080 by
default), `SITE_NAME`, and `MEDIA_DIR` for uploads — which lands in `.fcms`
beside the database, so one directory is the whole of what the platform owns.

There is a Docker Compose file as well, if you would rather run Postgres beside
it: <https://forinda-cms.netlify.app/install/compose.yaml>.

Use whatever manager you already have — `pnpm start`, `yarn start`, `bun start`
all run the same script `init` wrote.

A `.env` file is not read for you — the server takes its configuration from the
environment and nothing else, which is right for a container and awkward at a
terminal. Nineteen lines of `scripts/server.mjs` fixes that for local work:

```js
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const env = { ...process.env };
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (match) env[match[1]] = match[2];
}

execFileSync("./node_modules/.bin/forinda-cms", [], { stdio: "inherit", env });
```

## 3. Point a directory at it

```sh
npm install --save-dev @forinda/fcms-cli

npx fcms link http://localhost:4711
npx fcms login
```

> **`npx fcms` only works inside a project that has it installed**, where it
> runs the local binary. Outside one, `fcms` is an unrelated package somebody
> else publishes — use the scoped name, `npx @forinda/fcms-cli <command>`. The
> same holds for `forinda-cms`, which is the server's binary and not its
> package name (`@forinda/fcms-core`).

`link` writes `fcms.json`, which names the server and holds no secret — commit
it. `login` writes a token to `~/.config/forinda-cms/credentials.json` at mode
`0600`, which is not in your project and must never be.

```sh
npx fcms status
```

## 4. Write the site

A site is a directory of YAML. The layout is derived from the keys, so a file's
name is a convenience and its `key` is the truth:

```
site.yaml           name, theme, header and footer, integrations
content/*.yaml      one content type per file
pages/*.yaml        one page per file
logic/*.yaml        automations
data/*.yaml         rows, for seeding or for version-controlled content
```

Start with a content type:

```yaml
# content/property.yaml
key: property
label: Property
labelPlural: Properties
titleField: name
permalink: /stay/{{ entry.slug }}
fields:
  - { name: name, label: Name, type: text, required: true }
  - { name: city, label: City, type: reference, to: city, required: true, filterable: true }
  - { name: stars, label: Star rating, type: number, min: 1, max: 5, filterable: true }
  # Computed by the platform from another type's rows — indexed, sortable, and
  # visible in the diff when it changes.
  - { name: score, label: Guest score, type: aggregate, of: review, on: property, field: score, fn: avg }
```

Then a page that lists them:

```yaml
# pages/search.yaml
key: search
path: /search
title: Search results
blocks:
  - type: list
    data:
      from: property
      where:
        - { field: stars, op: gte, value: { param: stars } }
      sort: { param: sort, allow: [score, stars], default: score, dir: desc }
      limit: 25
    item:
      - type: card
        attrs: { heading: "{{ item.name }}", to: "/stay/{{ item.slug }}" }
```

Three rules that will save you an afternoon:

- **`filterable: true` is what makes a field searchable.** It becomes a partial
  index scoped to your site and type. A filter on a field without it works and
  gets slower as you grow.
- **A query needs a `limit`, and 100 is the ceiling.** An unbounded query is a
  performance problem you cannot see until your business is doing well.
- **Conditions are data, never expressions.** `{ field, op, value }`, and the
  value is a literal, a `{ param: … }` from the request, or an `{ entry: … }`
  from the row a detail page is for. There is no `item.price > 100`.

Check it as you go — it reports the file, line and column:

```sh
npx fcms validate
npx fcms fmt          # rewrite every file in canonical form; `--check` in CI
```

## 5. Look at it

```sh
npx fcms dev
```

Serves the directory at `localhost:4321` and reloads on save. No server, no
database, no account — it reads the files. This is the loop you spend your time
in.

## 6. Publish it

```sh
npx fcms plan         # what applying would change
npx fcms apply        # do it
```

`plan` classifies every change and exits `2` if any of them is destructive, so
CI can gate on it without parsing anything. `apply` prints the same plan before
acting and refuses destructive changes unless you pass `--yes`.

Every change is stored with its inverse, so the admin's history screen can undo
it. That is true whichever door the change came through — this CLI, the admin,
or an agent.

To go the other way — the server's spec, written back as canonical files:

```sh
npx fcms pull             # the spec
npx fcms pull --content   # and the rows
```

`pull` then `fmt --check` is silent, so pulling never produces a diff you did
not write.

## 7. Let an agent drive it

```json
{
  "mcpServers": {
    "fcms": { "command": "npx", "args": ["-y", "@forinda/fcms-mcp"] }
  }
}
```

No path in it, on any machine. The server runs in your site directory and reads
the credentials `fcms login` already wrote, so there is no second secret. Ten
tools: read the spec, plan a change, apply it, undo it, and the four entry
operations.

An agent gets exactly the doors you do. It cannot reach the database, and every
change it makes is classified, gated and reversible — which is what makes
"let it try" a reasonable thing to say.

## Keeping up to date

All three packages carry the same number, so upgrade them together:

```sh
npm install --save-dev @forinda/fcms-core@latest @forinda/fcms-cli@latest @forinda/fcms-mcp@latest
```

Then restart the server. Migrations run on boot; there is no separate step and
nothing to remember.

## When something goes wrong

| It says | It means |
|---|---|
| `cannot reach http://localhost:4711` | The server is not running, or `fcms.json` points elsewhere. |
| the site is slow under load | The embedded database serves one query at a time. Move to a Postgres server — one variable, same schema. |
| `the database in … is already open in process N` | Another server is using that directory. Stop it, or point this one elsewhere with `DATABASE_URL`. |
| `not linked` | Run `fcms link <url>` in this directory. |
| `session expired` | Run `fcms login` again. Tokens are short-lived on purpose. |
| `refusing N destructive change(s)` | Read them, then `--yes` if that is what you meant. |
| `duplicate key "…"` | Two files declare the same key — `fmt` writes to the canonical filename, so an older copy is probably still there. |
