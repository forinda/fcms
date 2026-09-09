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
DATABASE_URL=postgres://user:pass@localhost:5432/my_site npm start
```

A `postgres://` URL is a server; anything else is a directory to keep files in.
`npx @forinda/fcms-core --help` lists every variable it reads — `PORT` (8080 by
default), `SITE_NAME`, and `MEDIA_DIR` for uploads — which lands in `.fcms`
beside the database, so one directory is the whole of what the platform owns.

There is a Docker Compose file as well, if you would rather run Postgres beside
it: <https://fcms.kickjs.app/install/compose.yaml>.

Use whatever manager you already have — `pnpm start`, `yarn start`, `bun start`
all run the same script `init` wrote.

**A `.env` file is read**, from the directory you start the server in:
`.env.<NODE_ENV>.local`, `.env.<NODE_ENV>`, `.env.local`, `.env`, in that order,
with the real environment winning over all of them. So the whole of step 2 is
usually four lines in a file:

```sh
# .env
PORT=4711
OWNER_EMAIL=you@example.com
OWNER_PASSWORD=a-password-of-at-least-12-characters
```

Keep it out of version control — `init`'s `.gitignore` already does.
`KICKJS_ENV_FILE=off` turns the whole thing off for a container, which wants its
configuration from the environment and nothing else.

## 3. Point a directory at it

`init` already added the CLI, so there is nothing to install:

```sh
npx @forinda/fcms-cli link http://localhost:4711
npx @forinda/fcms-cli login
```

> **The package is scoped; the binary is not.** Inside this project the bare
> `fcms` binary works, because the local one wins. But that name on its own
> belongs to an unrelated package somebody else publishes, so a line copied out
> of here and run somewhere else would fetch theirs. Every command below
> therefore names the package, or runs a script `init` already wrote — and the
> same holds for `forinda-cms`, which is the server's binary and not its package
> name.

`link` writes `fcms.json`, which names the server and holds no secret — commit
it. `login` writes a token to `~/.config/forinda-cms/credentials.json` at mode
`0600`, which is not in your project and must never be.

```sh
npx @forinda/fcms-cli status
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
npm run validate
npm run fmt          # rewrite every file in canonical form; `--check` in CI
```

## 5. Look at it

```sh
npm run dev
```

Serves the directory at `localhost:4321` and reloads on save. No server, no
database, no account — it reads the files. This is the loop you spend your time
in. If the port is taken it steps to the next free one and says so.

To choose the port, `fcms.json` can hold one — `fcms link` writes it — or:

```sh
npm run dev -- --port 4000    # the `--` is npm's: without it npm eats the flag
pnpm dev --port 4000          # pnpm, yarn and bun need no separator
```

## 6. Publish it

```sh
npm run plan            # what applying would change
npm run apply           # do it
npm run apply -- --yes  # …including the destructive parts
```

The `--` is npm's, not ours: without it the flag goes to npm rather than to the
command it runs.

`plan` classifies every change and exits `2` if any of them is destructive, so
CI can gate on it without parsing anything. `apply` prints the same plan before
acting and refuses destructive changes unless you pass `--yes`.

Every change is stored with its inverse, so the admin's history screen can undo
it. That is true whichever door the change came through — this CLI, the admin,
or an agent.

To go the other way — the server's spec, written back as canonical files:

```sh
npx @forinda/fcms-cli pull             # the spec
npx @forinda/fcms-cli pull --content   # and the rows
```

`pull` then `fmt --check` is silent, so pulling never produces a diff you did
not write.

## 7. Be found

Nothing to turn on. Every page carries a title, a description, a canonical link,
Open Graph and Twitter tags, and the site's own `lang`. Drafts are `noindex`
automatically. `/robots.txt`, `/sitemap.xml` — with a `lastmod` per page taken
from the row behind it — and `/llms.txt` are generated from the spec, so none of
them can go stale. Change a page's path and the old one 301s to the new one,
because the change was recorded with its inverse.

Two things worth doing by hand:

```yaml
# content/property.yaml — structured data, once per type, forever
jsonld:
  type: Hotel
  properties: { name: name, description: summary, image: photo }
```

```yaml
# pages/property-detail.yaml — templated, so every entry gets its own
seo:
  title: "{{ entry.name }} in {{ entry.city }}"
  description: "{{ entry.summary }}"
```

Set `PUBLIC_URL` so canonicals and the sitemap are absolute. Turn the whole lot
off for a staging copy with one switch — and name an analytics provider rather
than pasting a script:

```yaml
# site.yaml
seo: { indexable: false }
analytics: { gtag: G-ABC1234567 }
```

Full details in [REFERENCE.md](REFERENCE.md) and at
<https://fcms.kickjs.app/docs/seo/>.

## 8. Let an agent drive it

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
