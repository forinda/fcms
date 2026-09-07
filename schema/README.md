# Generated schema

`site.schema.json` is generated from `packages/spec` by `pnpm schema`. **Do not
edit it** — `pnpm schema:check` fails CI if it drifts from the Zod definitions.

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

## The caveat

This is the schema for a **whole spec document**. The canonical file layout
splits one across `site.yaml`, `content/`, `pages/` and `logic/` (ADR 0006), so
a single content-type file does not validate against it — it is a fragment.

Per-fragment schemas are the obvious next step and are not built yet; the
authoritative check remains `fcms validate`, which assembles the files first and
then validates the whole, because cross-file references can only be checked once
everything is present.
