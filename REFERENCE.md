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
nobody should read a compatibility table. **The binaries are not the package
names**: outside a project that has them installed, `npx fcms` is somebody
else's package. Use `npx @forinda/fcms-cli`.

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

The server reads its configuration from the environment and nothing else, which
is right for a container and awkward at a terminal.

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
