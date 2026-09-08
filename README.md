# forinda-cms

**Your whole site is one file you can read.** Content types, pages, logic,
access, integrations — declared, not scattered across a plugin directory and a
database nobody wants to open.

Edit it three ways, and they are the same edit:

- **In the admin**, as forms — no YAML in sight.
- **In files**, with `fcms` — review it in a pull request like any other change.
- **With an AI assistant**, which proposes a change you approve or reject.

Same validation, same history, same undo, whichever door the change came
through.

```yaml
content:
  - key: booking
    label: Booking
    fields:
      - { name: name,  type: text,  required: true }
      - { name: when,  type: datetime }
      - { name: state, type: state, values: [pending, confirmed, done] }
```

📖 **Docs and a longer tour: <https://forinda-cms.netlify.app>**

## Install

Docker and about two minutes.

```bash
mkdir my-site && cd my-site
curl -O https://forinda-cms.netlify.app/install/compose.yaml
curl -o .env https://forinda-cms.netlify.app/install/env.example
# edit .env — POSTGRES_PASSWORD, OWNER_EMAIL, OWNER_PASSWORD
docker compose up -d
```

No migration step, no setup wizard: it migrates and provisions itself on boot,
so `up` lands on a working site. Backups and proxy notes are in
[`install/README.md`](install/README.md).

No Docker? A Node 22+ machine and a Postgres URL are enough:

```bash
DATABASE_URL=postgres://… npx @forinda/fcms-core
```

## The CLI

```bash
npm install -g @forinda/fcms-cli

fcms dev      # preview a site directory locally, no server needed
fcms plan     # what publishing would change
fcms apply    # publish it
```

`plan` and `apply` show you the change before making it, and refuse anything
destructive unless you say `--yes`.

## What works today

The spec and its language, the renderer, the admin with its visual canvas, the
CLI, the MCP server for agents, and the install. On top of those, a business
that takes bookings has the whole path: availability by appointment or by date
range, distance, multi-step booking journeys, deposits, automations that confirm
and notify, and visitors who see their own bookings and nobody else's.

Worth knowing before you rely on it:

- The M-Pesa and messaging providers are written against documented APIs but
  have **never been run against a live account**. The product says so where they
  are used; payment at the counter needs no account at all.
- Plugins have a contract (`@forinda-cms/plugin`) but no marketplace. Installing
  one is a dependency and a deploy, reviewed — not a button.
- There is no hosted service. Self-host it, or run it for your clients.

## Developing

```bash
pnpm install
pnpm dev        # the engine, with HMR
pnpm verify     # typecheck, lint, format, schema, every test — exactly what CI runs
```

The database suites skip themselves when `DATABASE_URL` is unset, so this stays
runnable on a laptop with no Postgres. `pnpm --filter @forinda-cms/engine seed`
loads the reference site in `examples/salon`.

## Releases

One calendar-versioned tag publishes the image, the server package and the CLI,
all carrying the same number. [`RELEASE.md`](RELEASE.md) has the detail.

## Contributing

Issues and pull requests are welcome — [`CONTRIBUTING.md`](CONTRIBUTING.md) has
the workflow, and [`.agents/AGENTS.md`](.agents/AGENTS.md) the framework
conventions. Open an issue before a large change; it saves you writing a patch
the design cannot take.

## Licence

**AGPL-3.0-or-later** for the product — the engine, the admin, the renderer and
the `fcms` CLI. Self-host it, modify it, run it for clients. The one obligation:
if you run a *modified* version that other people reach over a network, publish
your changes.

**Apache-2.0** for the interop surface — `@forinda-cms/spec`,
`@forinda-cms/lang`, `@forinda-cms/sdk` and `@forinda-cms/plugin`. The file
format, the client and the plugin API are meant to be copied.

Your specs, content, themes and plugins are yours; nothing here claims them.
A commercial licence is available for anyone the AGPL does not suit —
[`LICENSING.md`](LICENSING.md) has the detail, including what the AGPL actually
asks of you (for most people: nothing).
