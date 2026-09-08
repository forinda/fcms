# Contributing

How work lands in this repo. Framework conventions are not repeated here —
[`.agents/AGENTS.md`](.agents/AGENTS.md) is authoritative for those, and
[`.agents/skills/`](.agents/skills/) has one recipe per common task.

---

## The workflow

1. **Read the decision first.** Anything structural has an ADR in
   [`docs/decisions/`](docs/decisions/). If your change contradicts one, the
   change is not wrong — the ADR needs superseding, in the same PR, with the
   reason. Records are amended and superseded, never quietly edited once code
   depends on them.
2. **Branch, then PR.** `main` is protected by CI. A PR body says what changed
   and *why the alternative was worse*; the diff already says what.
3. **Green before review.** `pnpm verify` — typecheck, lint, format, schema
   check, every suite. It is exactly what CI runs.
4. **Small and whole.** One change per PR, including its tests and the docstring
   that explains it. A PR that adds a use-case and leaves the ADR stale is two
   PRs, one of which never gets written.

## Where code goes

| You are adding | It belongs in |
|---|---|
| An HTTP route | `apps/engine/src/modules/<surface>/*.controller.ts` |
| A decision — validate, gate, classify, write | a use-case beside that controller |
| A query | a repository in `apps/engine/src/shared/repositories/` |
| A table or a column | `packages/db/src/schema/` — one file per table |
| Something two apps need | a package under `packages/` |
| A helper a module uses | that module's `utils/`, not its root |

Two rules with teeth:

- **Controllers do not touch repositories.** A controller calls a use-case; the
  use-case owns the decision and the repository owns the query. A repository in
  a controller is the data layer leaking into HTTP, and it is what makes a
  screen untestable without a server.
- **Decorated classes live under `apps/*/src`.** The module glob eagerly imports
  that tree so `@Service` / `@Repository` / `@Controller` register in the
  container. A decorated class inside `packages/` is never imported, never
  registers, and fails at the first request as `No provider for X` — not at
  boot, and not in a way that names the class.

## Tokens and DI

- A DI token lives in a module that **imports nothing from the app**
  (`apps/engine/src/shared/db.ts`) or beside the contributor that resolves its
  value (`CURRENT_SCOPE`). Declaring a token next to the code that registers it
  invites an import cycle, and a cycle here fails silently: `@Inject(undefined)`
  records no token, the container falls back to the parameter's reflected type,
  an interface reflects as `Object`, and every route dies on
  `No provider for Object` — naming neither the class nor the token.
- Constructor injection with an explicit `@Inject(TOKEN)` on every parameter, so
  a test can still construct the class by hand with plain arguments.

## Tests

- **Every non-trivial decision gets one**, and the test names the property, not
  the method: *"gives the same answer for a wrong password and an unknown
  account"*, not *"login works"*.
- **Database suites skip without `DATABASE_URL`** so the repo runs on a laptop
  with no Postgres. Credentials come from `.env.test` at the repo root; an
  exported variable wins over the file.
- **Never point a suite at your development database.** They truncate tables.
- Fixtures must exercise the thing under test. A round-trip test whose fixture
  omits the section the code drops passes while the bug ships — that has
  happened here, three times, to the same splitter.

## Commits

Conventional prefixes (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`), a
subject that reads as a sentence, and a body that says **why**. When a commit
fixes something that was quietly wrong, say what the symptom was — the next
person searches for the symptom, not the fix.

## Security

- Deny by default. Routes are public only via an explicit flag, applied per
  surface (ADR 0008 §4), never per route.
- Nothing that takes a path, SQL, or a template string from a caller.
- Passwords are arguments to nothing: not to a CLI flag, not to a URL. Prompt,
  or read an environment variable.
- A credential the admin cannot list and revoke is a credential nobody revokes —
  which is why the CLI carries a session rather than an API key.

## Licensing your contribution

This project is dual licensed: AGPL-3.0-or-later to everyone, and commercially
to anyone who cannot take the AGPL (`LICENSING.md`). That second half only works
if one party holds the copyright to the whole work, so a pull request needs a
signed contributor licence agreement before it can be merged — you keep your
copyright and grant the rights needed to relicense.

It is a real cost and it is stated here rather than sprung on you at review
time. If it is a dealbreaker, say so in the issue: a bug report with a clear
reproduction is worth more than a patch nobody can merge.

Contributions to the Apache-2.0 packages — `spec`, `lang`, `sdk`, `plugin` —
need no agreement. Apache-2.0 already grants what is needed, which is part of
why the interop surface is licensed that way.
