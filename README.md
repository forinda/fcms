# forinda-cms

A self-hostable CMS where the site is a **spec** — content types, pages, logic,
access, integrations — rather than a pile of plugins and a database nobody can
read. One declarative artifact, edited by a person through forms, by a developer
through files, and by a model through a governed tool table. Same validation,
same history, same undo, whichever door a change came through.

**Status: self-hostable, and doing real work.** The spec and the language, the
renderer, persistence with a patch spine, the HTTP engine, the admin and its
visual canvas, the CLI, the MCP server, the assistant and the install are built
and verified. On top of them a business that takes bookings has the whole path:
availability by appointment or by date range, distance, a multi-step journey,
deposits, automations that confirm and notify, and visitors who can see their
own bookings and nobody else's.

Not done, stated here because finding out later is worse: the M-Pesa and
messaging providers are implemented against documented APIs and have **never
been run against a live account** — the product says so where they are used, and
payment at the counter needs no account at all. Plugins have a contract
(`@forinda-cms/plugin`) but no marketplace: installing one is a dependency and a
deploy, reviewed, rather than a button. There is no hosted service.

---

## Install (target: a stranger, on a small VPS)

```bash
mkdir my-site && cd my-site
curl -O https://forinda-cms.netlify.app/install/compose.yaml
curl -o .env https://forinda-cms.netlify.app/install/env.example
# edit .env — POSTGRES_PASSWORD, OWNER_EMAIL, OWNER_PASSWORD
docker compose up -d
```

No migration step and no setup command: the app migrates and provisions itself
on boot, so `up` reaches a working site. Details, backups and proxy notes in
[`install/README.md`](install/README.md).

## Develop

```bash
pnpm install
pnpm dev                     # the engine, with HMR
pnpm --filter @forinda-cms/marketing dev
pnpm verify                  # typecheck + lint + format + schema + every test
```

`pnpm verify` is what CI runs — there is no CI-only step to discover after the
fact. The database suites skip themselves when `DATABASE_URL` is unset, so the
repo stays runnable on a laptop with no Postgres; CI supplies one so the
guarantees they cover are actually exercised.

| Command | What it does |
|---|---|
| `pnpm dev` | Engine on `PORT` from `apps/engine/.env`, Vite HMR |
| `pnpm build` / `pnpm start` | Production bundle, then run it |
| `pnpm test` | Every suite in the workspace |
| `pnpm verify` | Everything CI checks |
| `pnpm docker:build` | The install image, locally |
| `pnpm --filter @forinda-cms/engine seed` | Load `examples/salon` into a database (`EXAMPLE=rooms` for the guesthouse) |

## Layout

```
apps/
  engine/          the deployable: public site, admin, management API
    src/modules/     site · admin · api        (controllers + their use-cases)
    src/shared/      repositories, auth, reads used by more than one module
    src/adapters/    the database adapter — DI wiring and boot
    src/contributors/ per-request context: which site, who is calling
  marketing/       the static marketing site (Astro), ships to a CDN
packages/
  spec/            the schema every surface writes to — types, patches, diff
  lang/            YAML 1.2 profile: parser, canonical printer, file layout
  render/          spec + rows → HTML, behind an EntrySource seam
  db/              the model: tables, row types, migration planner, pool
  sdk/             the client boundary: the HTTP client, the link, the token
  cli/             `fcms`: validate, fmt, diff, dev, link, login, plan, apply
  mcp/             `fcms-mcp`: ten tools over the SDK, for an agent
  ai/              the planner: one prompt, shared by the assistant and the evals
  eval/            the harness for ADR 0007's model tests
docs/decisions/    ADRs — the reasoning, numbered and dated
research/          the fourteen research docs the ADRs argue from
examples/salon/    the reference spec; ADR 0007 test 1's artifact
install/           compose.yaml, .env.example, backup.sh — the whole install
```

Two rules hold this shape together:

- **A repository or use-case lives with the controller that calls it**, not in a
  package. A decorated class outside `apps/*/src` is never reached by the
  module glob, so its DI registration never happens — the layering rule and the
  framework agree.
- **`packages/db` is the model.** Tables, row types, the migration planner, the
  pool. Nothing that decides anything.

## How a change lands

Every mutation — a form, `fcms apply`, and later a model — goes through one
path: validate → diff → classify → gate destructive → write with an inverse.
That is why undo is a table lookup rather than a git operation, and why the
destructive warning ("340 customers will lose this field") is the same sentence
in all three surfaces.

## Reading order

1. [`docs/decisions/README.md`](docs/decisions/README.md) — the ADR index. Start
   with [0002](docs/decisions/0002-phase-0-scope.md) (what Phase 0 is),
   [0001](docs/decisions/0001-spec-ceiling.md) (what the spec may contain), and
   [0006](docs/decisions/0006-surface-syntax.md) (why the syntax is YAML).
2. [`research/`](research/) — the fourteen documents the ADRs argue from.
3. The module docstrings. Every controller and use-case opens with what it
   owns and which decision it implements; that is where the reasoning lives.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the workflow, and
[`.agents/AGENTS.md`](.agents/AGENTS.md) for framework conventions — decorator
patterns, DI, env wiring, generators, and the gotchas that cost a day each.
