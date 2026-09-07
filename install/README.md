# Installing forinda-cms

Two files and one command.

```bash
mkdir my-site && cd my-site
curl -O https://raw.githubusercontent.com/forinda/forinda-cms/main/install/compose.yaml
curl -o .env https://raw.githubusercontent.com/forinda/forinda-cms/main/install/.env.example
# edit .env — set POSTGRES_PASSWORD and SITE_NAME
docker compose up -d
```

That is the whole install. Open `http://localhost:8080`.

**There is no migration step and no setup command.** The app migrates and
provisions itself on boot, so `up` reaches a working site rather than a 404 and
an instruction. Booting again changes nothing — migrations keep their ledger
inside the database, and provisioning only runs when there is no site.

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

Pin a version in `.env` (`VERSION=2026.3`) if you would rather not track
`latest`. Core uses CalVer — the year and which release of that year (ADR 0012).

## Backups

```bash
./backup.sh                     # → backups/forinda-cms-<timestamp>.sql.gz
./backup.sh restore <file>      # asks before replacing anything
```

ADR 0011: **export always works and is never withheld.** For a self-hoster that
means a plain `pg_dump` any Postgres can read — the spec, its whole patch
history, and the content, with no account and no export queue.

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
