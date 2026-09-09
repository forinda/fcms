# Reference

Every command, every file, every setting. [GUIDE.md](GUIDE.md) is how to build a
site; [ARCHITECTURE.md](ARCHITECTURE.md) is what the database is doing; this is
the surface in between.

The spec language itself — every field type, block and operator — is generated
from the schema at <https://fcms.kickjs.app/docs/reference/>.

## The three packages

| | |
|---|---|
| `@forinda/fcms-core` | the server. Binary: `forinda-cms` |
| `@forinda/fcms-cli` | the tool you type. Binary: `fcms` |
| `@forinda/fcms-mcp` | the same doors for an agent. Binary: `fcms-mcp` |

All three carry the same version, because one is the client of the other and
nobody should read a compatibility table.

**The binaries are not the package names.** Inside a project that has the CLI
installed, running the bare `fcms` binary works — the local one wins. Outside
one, asking a runner for that bare name asks npm for it, and it belongs to
somebody else. Name the package: `npx @forinda/fcms-cli <command>`.

## Files in a project

| | |
|---|---|
| `site.yaml` | name, locale, currency, theme, header and footer, integrations |
| `content/*.yaml` | one content type per file |
| `pages/*.yaml` | one page per file |
| `logic/*.yaml` | one automation per file |
| `data/*.yaml` | rows, if you keep any in version control |
| `fcms.json` | **the project's own settings.** Committed |
| `.fcms/` | the embedded database and uploaded media. Never committed |
| `.mcp.json` | how an agent reaches this site |

The file a thing lives in is derived from its `key`, so `fcms fmt` may move a
node into the file it belongs in. That is the bargain that keeps round-tripping
exact: `fcms pull` followed by `fcms fmt --check` is silent.

### `fcms.json`

```json
{
  "url": "https://my-site.example",
  "port": 4321
}
```

| | |
|---|---|
| `url` | the server this directory publishes to. Written by `fcms link` |
| `port` | what `fcms dev` serves on. `--port` beats it; without either, 4321 |

**Committed on purpose.** Nothing in it is a secret, and it is what a second
person needs before they can `plan` or `apply` against the same site. The token
is not here — it is in `~/.config/forinda-cms/credentials.json` at mode `0600`,
per server, and it never enters a repository.

## Commands

Nothing below needs a server except the second group.

| | |
|---|---|
| `fcms init [dir]` | write a project you can already run |
| `fcms validate [dir]` | is this valid, and what routes does it have |
| `fcms fmt [dir]` | rewrite every file in canonical form |
| `fcms diff <before> <after>` | what changed between two versions, in words |
| `fcms dev [dir]` | serve it locally, reloading on save |

| | |
|---|---|
| `fcms link <url> [dir]` | name the server this directory publishes to |
| `fcms login [dir]` | sign in. The token is stored `0600` in your home directory |
| `fcms logout [dir]` | forget the token for a server |
| `fcms status [dir]` | what that server currently has |
| `fcms pull [dir]` | write the server's spec back out as files |
| `fcms plan [dir]` | what applying would change |
| `fcms apply [dir]` | do it |

### Options

| | |
|---|---|
| `init --starter <key>` | `bookings`, `enquiries` or `blank` |
| `init --name <name>` | the site's name, when the directory's is not it |
| `init --force` | scaffold into a directory that already has files |
| `fmt --check` | change nothing, exit non-zero if any file is not canonical |
| `dev -p, --port <number>` | beats `fcms.json`, which beats 4321 |
| `login --url <url>` | a server other than the linked one |
| `login --email <email>` | skip the prompt |
| `logout --url <url>` | a server other than the linked one |
| `pull --content` | the rows as well as the spec |
| `apply -y, --yes` | allow destructive changes |
| `apply --content` | push the rows as well as the spec |

### Exit codes

| | |
|---|---|
| `0` | it worked |
| `1` | it did not — a spec error, no link, no token, a server that refused |
| `2` | **`plan` found destructive changes**, or `apply` refused them |

`2` is what CI gates on, without parsing anything.

### `FCMS_PASSWORD`

Read by `fcms login` so a password never reaches a process list, where every
other user on the machine can read it.

## Settings for the server

From the environment, or from a `.env` in the directory it starts in —
`.env.<NODE_ENV>.local`, `.env.<NODE_ENV>`, `.env.local`, `.env`, in that order,
with the real environment winning. `KICKJS_ENV_FILE=off` reads none of them;
`KICKJS_ENV_FILE=a,b` reads those.

The admin is served by this, at `/admin`. The `fcms` CLI never runs it — it
talks to a running server over HTTP once `fcms link` and `fcms login` have been
run.

| | |
|---|---|
| `DATABASE_URL` | a `postgres://` URL, or a directory. Default `./.fcms/db` — Postgres in this process |
| `PORT` | default `8080` |
| `OWNER_EMAIL`, `OWNER_PASSWORD` | the first owner, created once on first boot. At least 12 characters |
| `SITE_NAME` | what the first site is called |
| `MEDIA_DIR` | uploads. Default `./.fcms/media` |
| `PUBLIC_URL` | the address the site is reached at, for canonicals and the sitemap |
| `SITE_ID`, `ORG_ID` | default `default`. One install, one site, today |
| `SITE_TIMEZONE` | default `UTC` |
| `SECURE_COOKIES` | `true` behind HTTPS |
| `TRUST_PROXY` | `true` behind a reverse proxy |
| `NODE_ENV`, `LOG_LEVEL` | as usual |

`npx @forinda/fcms-core --help` prints this list from the binary itself.

## Journeys

A page can carry a flow: steps a visitor goes through, with the state on the
server and no JavaScript. A step is answered in one of two ways, never both.

```yaml
flows:
  - key: booking
    steps:
      # Asks. The parameters go back into the address when the step is
      # answered, so everything after it filters by `{ param: … }` as usual.
      - key: dates
        label: Your dates
        captures: [check_in, check_out]
        blocks: [ … a filters block … ]
      # Offers. The chosen row is looked up in what the step actually showed,
      # never taken from the request.
      - key: room
        label: Your room
        selects: { from: room, as: room }
        blocks: [ … a list … ]
```

A capturing step shows a Continue once every parameter it names has a value,
and the last step is whatever its blocks are — usually the form that completes
the journey.

## Styling

Three tiers, in order: a theme, then structured properties, then custom CSS.

```yaml
- type: section
  style: { background: brand, contentWidth: container }
  children:
    - type: card
      style: { variant: price }
      css: |
        img { aspect-ratio: 1 }
        h3 { font-size: 1.1rem }
        &:hover { opacity: .95 }
```

`contentWidth` measures a block's **children** and leaves the block alone. A
full-bleed band with contained content is the commonest layout on any site and
`width` cannot express it, because constraining a section constrains its
background too.

`variant` is each block's own list — `button` takes `primary`, `secondary`,
`outline`; `card` takes `plain`, `elevated`, `price`. A variant a block does not
declare is ignored rather than styled by accident, and the full list per block is
in the [reference](https://fcms.kickjs.app/docs/reference/).

**In `css`, the author never writes a selector.** Declarations apply to the
block; a nested rule is prefixed with the block's own class, and `&` is the block
itself. One level deep, and anything that is not a declaration is dropped — so
block CSS cannot reach an element the block does not own, whatever is typed into
it. Site-wide `css` on `site.yaml` is the one explicit escape hatch and is gated
to the `developer` role.

## Search, sharing and structured data

Every page carries these without being asked. There is no SEO plugin because
there is nothing for one to ask: the content type already declares its shape.

| | |
|---|---|
| `<title>`, `meta description` | from the page, resolved per entry on a collection page |
| `link rel="canonical"` | this page's own address, absolute when `PUBLIC_URL` is set |
| `html lang`, `og:locale` | the site's `locale` |
| Open Graph | `og:title`, `og:description`, `og:image`, `og:image:alt`, `og:url`, `og:type`, `og:site_name` |
| Twitter/X | `twitter:card` (large image when there is one), `title`, `description`, `image` |
| JSON-LD | when the content type has a `jsonld` mapping |
| `noindex` | on drafts, automatically |

Per page, templated so one collection page covers every entry:

```yaml
seo:
  title: "{{ entry.name }} in {{ entry.city }}"
  description: "{{ entry.summary }}"
  image: "asset:hero"
  noindex: false
```

Per content type, once:

```yaml
permalink: /stay/{{ entry.slug }}
jsonld:
  type: Hotel          # Article, Event, Product, Service, LocalBusiness,
  properties:          # Person, Organization, Recipe, JobPosting, FAQPage,
    name: name         # Review, LodgingBusiness, Place, TouristAttraction,
    description: summary   # Restaurant
    image: photo
```

**Changing a page's path 301s the old one automatically** — the change was
stored with its inverse, so the platform knows where that address used to point.
Only when the page still exists somewhere else: a deleted page has nowhere to
send anyone, and redirecting it to the homepage claims a move that did not
happen.

## What a site publishes to machines

Three files nobody writes: they are generated from the spec, so they cannot go
stale, and `site.yaml` decides whether they exist.

| | |
|---|---|
| `/robots.txt` | points at the sitemap |
| `/sitemap.xml` | every public page, each with a `lastmod` from the row behind it |
| `/llms.txt` | what this site is, for a model rather than a crawler |

```yaml
# site.yaml
seo:
  indexable: true   # false: every page noindex, robots.txt disallows, no sitemap
  sitemap: true
  llms: true
```

`indexable: false` is the switch for a staging copy or a site before launch —
one decision at the level it is actually made, rather than `noindex` on every
page and one forgotten. `llms.txt` is not gated on it, because they are
different questions: a site kept out of search may still be one an agent has
been pointed at deliberately.

Draft pages and `seo.noindex` pages are in neither the sitemap nor `llms.txt`.

### Analytics

```yaml
# site.yaml
analytics:
  gtag: G-ABC1234567          # Google Analytics 4
  plausible: example.com      # the domain it counts under
  umami: { id: "…", src: "https://umami.example/script.js" }
```

**There is no field for a pasted `<script>`, and there will not be.** A spec is
data an agent may propose and a form may submit; arbitrary JavaScript in it is a
cross-site scripting hole with an approval workflow in front of it. Providers
are named, the snippet is ours, and adding one is a reviewed change to
`packages/render/src/agents.ts`.

## For an agent

```json
{ "mcpServers": { "fcms": { "command": "npx", "args": ["-y", "@forinda/fcms-mcp"] } } }
```

It runs in the site directory and reads the credentials `fcms login` wrote, so
there is no second secret. `FCMS_URL` and `FCMS_TOKEN` override, for an agent
that never ran the CLI.

| | |
|---|---|
| `site_status` | what the site has right now |
| `site_spec` | read the whole spec |
| `site_plan` | what a change would do, before it does it |
| `site_apply` | do it — destructive changes refused unless allowed |
| `site_history` | what has changed, and who changed it |
| `site_undo` | undo the last change |
| `entry_list`, `entry_create`, `entry_update`, `entry_delete` | the rows |

Every change goes through the same validate → diff → classify → gate path as the
admin and the CLI, and every one is recorded with an inverse. An agent cannot
reach the database, and cannot make a change a person cannot see or undo.

## Working on this repository

| | |
|---|---|
| `pnpm dev` | the engine, with HMR |
| `pnpm fcms <command>` | the CLI from source, without installing it |
| `pnpm verify` | typecheck, lint, format, schema, every test — what CI runs |
| `pnpm release` | cut a release: bumps the manifests, commits, tags, pushes |
| `pnpm notes` | preview the release notes for what is unreleased |
| `EXAMPLE=stays pnpm --filter @forinda-cms/engine seed` | load a reference site into a database |
