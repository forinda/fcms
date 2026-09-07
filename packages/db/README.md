# @forinda-cms/db

Postgres persistence: sites, specs, and the patch spine.

## Setup

```bash
createdb forinda_cms   # or: docker exec <pg> psql -U <user> -c 'CREATE DATABASE forinda_cms;'
export DATABASE_URL="postgres://user:pass@localhost:5432/forinda_cms"
pnpm --filter @forinda-cms/db db:migrate
```

Migrations are **idempotent and resumable** — Drizzle keeps its ledger inside
the target database, so a run that died halfway continues rather than replaying.
That is the property doc 09 §6 relies on, and the reason the install artifact can
migrate on boot instead of asking a self-hoster to run a command.

Tests skip when `DATABASE_URL` is unset, so `pnpm verify` still passes on a
machine with no database — the same reasoning as the eval harness replaying by
default: a suite that cannot run is a suite nobody runs.

## What is here, and why it is shaped this way

| Decision                                 | Where           | Because                                                                                              |
| ---------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| `org_id` + `site_id` on every table      | `schema.ts`     | ADR 0002 seam 1, ADR 0008 — cheap now, a migration of every table later                              |
| Every query through a scoping repository | `repository.ts` | The seam only pays off if nothing can bypass it, so scope is a constructor argument, not a parameter |
| `jsonb` for entry data, not EAV          | `schema.ts`     | doc 03 §2 — EAV turns a two-condition filter into self-joins per condition                           |
| The spec stored whole, not decomposed    | `siteSpecs`     | The decomposition that matters is the _file_ layout (ADR 0006), and it is derived                    |
| `inverse` is `not null`                  | `specPatches`   | doc 13's argument needs a wrong "yes" to be cheap, which needs the inverse written at the time       |
| Destructive changes refused by default   | `applySpec`     | A gate that applies unless told otherwise is advisory, not a gate                                    |
| History is append-only                   | `revertedAt`    | "What happened last Tuesday" has to survive an undo                                                  |

## The seam that paid off

`loadEntrySource` returns the same `EntrySource` interface the spike backed with
`data/*.yaml`. The renderer cannot tell the difference, so Phase 0b swapped the
implementation and **nothing above that line changed** — there is a test that
renders a page from database rows through the untouched renderer.

## Not here yet

- **The migration planner.** Content-type changes do not yet emit generated
  columns and indexes for filterable fields (doc 03 §2). The GIN index on `data`
  covers queries in the meantime.
- **Assets.** The table exists; nothing writes to it (ADR 0010 is Phase 1+).
- **Multi-site resolution.** `siteByDomain` exists; the `LoadSite` contributor
  that would use it does not.
