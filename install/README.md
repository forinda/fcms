# Installing forinda-cms

Two files and one command.

```bash
mkdir my-site && cd my-site
curl -O https://forinda-cms.netlify.app/install/compose.yaml
curl -o .env https://forinda-cms.netlify.app/install/env.example
# edit .env — set POSTGRES_PASSWORD and SITE_NAME
docker compose up -d
```

That is the whole install. Open `http://localhost:8080`.

**There is no migration step and no setup command.** The app migrates and
provisions itself on boot, so `up` reaches a working site rather than a 404 and
an instruction. Booting again changes nothing — migrations keep their ledger
inside the database, and provisioning only runs when there is no site.

These are served by the marketing site rather than from the repository, which
is private. A private repository's raw files 404 for everyone else — and so do
its release assets, which sit behind the same authentication as its code. The
site is already public, the files are copied into it at build time from this
directory, and there is one source of truth: this one.

The image itself is public: `ghcr.io/forinda/fcms`.

## Why this file exists

Doc 09 calls the self-install artifact *"the part with no precedent in either
scouted repo"*, and ADR 0002 put it in Phase 0b because *"a stranger can install
it"* is half the wedge. WordPress won on a five-minute install; if the front door
is harder than that, the ownership argument is theoretical.

## Upgrading

```bash
docker compose pull && docker compose up -d
```

Migrations are idempotent and resumable, so an interrupted upgrade is re-runnable
rather than a state to reason about.

**Before the first release, `.env` ships `VERSION=edge`** — the tip of main,
rebuilt on every merge, which is what exists until a version is tagged. Once
there is one, pin it (`VERSION=2026.1`) and upgrade deliberately: `edge` makes
no promise about what changed between two pulls. Core uses CalVer — the year and
which release of that year (ADR 0012) — and `latest` moves only on a tagged
release.

## Backups

```bash
./backup.sh                     # → backups/forinda-cms-<timestamp>.sql.gz
./backup.sh restore <file>      # asks before replacing anything
```

ADR 0011: **export always works and is never withheld.** For a self-hoster that
means a plain `pg_dump` any Postgres can read — the spec, its whole patch
history, and the content, with no account and no export queue.

Restoring stops the app first, so nothing writes mid-restore, and asks you to
type the database name — the one command here that can lose data should be hard
to run by accident. Uploaded media is not in Postgres; once the asset store
exists (ADR 0010), back its bucket up alongside this.

## Resource floor

Two services, deliberately: Postgres and the app. No Redis, no separate queue,
no object store. Doc 14 targets a 1–2 GB VPS because that is the mainstream box
in the market this is built for, not a nostalgia tier.

## Putting it on the internet

`compose.yaml` publishes the app on `HTTP_PORT` and does **not** publish
Postgres — the app reaches it over the compose network. Put a TLS terminator in
front (Caddy, nginx, a load balancer), then set:

```
PUBLIC_URL=https://yourdomain
TRUST_PROXY=true
```

`PUBLIC_URL` is what canonical URLs and `sitemap.xml` use (doc 08). `TRUST_PROXY`
should stay `false` until something in front actually sets `X-Forwarded-Host` —
trusting it otherwise lets a caller choose their own host.

## Editing the site

For now, with the CLI:

```bash
fcms validate ./spec
fcms dev ./spec
```

The admin and the chat surface are the rest of Phase 0b and Phase 1. Until then
the spec is a directory of YAML, which is the point — it is readable, diffable,
and yours whether or not anything else exists.
