# Generated schema

These are generated from `packages/spec` by `pnpm schema`. **Do not edit them** —
`pnpm schema:check` fails CI if they drift from the Zod definitions.

| File | Validates |
|---|---|
| `site.schema.json` | `site.yaml` — theme, layout, access, wiring |
| `content-type.schema.json` | `content/*.yaml` |
| `page.schema.json` | `pages/*.yaml` |
| `workflow.schema.json` | `logic/*.yaml` |
| `spec.schema.json` | a whole spec in one file, which `parseSpec` still accepts |

## Why it exists

ADR 0006 chose a strict YAML profile partly on this argument:

> Generate JSON Schema from `packages/spec` in CI; the existing YAML language
> server gives autocomplete, inline validation and hover docs in VS Code and
> JetBrains. Doc 11 listed editor support as a real cost of having human authors
> — this discharges most of it without writing an LSP.

Until the file existed that was a claim. It now ships, `.vscode/settings.json`
points the YAML language server at it, and CI keeps it current.

**A stale schema is worse than none**, because an editor would confidently accept
a spec the parser rejects — hence `--check` rather than trusting people to
regenerate.

## Using it outside VS Code

Any editor with a YAML language server reads an inline directive:

```yaml
# yaml-language-server: $schema=../../schema/site.schema.json
specVersion: 1
name: Riverside Salon
```

## One schema per file, and why

The first version emitted only the whole-document schema and pointed editors at
it for `site.yaml`. That file carries no `content`, so the editor reported the
collections as missing and **confidently contradicted the parser** — the "a stale
schema is worse than none" failure one step removed: not stale, just aimed at the
wrong document.

## What these still cannot check

Cross-file references. A page querying a content type is only checkable once both
files are present, so `fcms validate` stays authoritative — it assembles the
layout first and then validates the whole. An editor will happily accept
`from: treatment` when no such type exists anywhere.
