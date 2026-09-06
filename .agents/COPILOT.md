# COPILOT.md — forinda-cms

**Read `./AGENTS.md` first.** It is the canonical, multi-agent
reference for this project — every convention, structure, decorator
pattern, env wiring rule, generator usage. This file is a thin
Copilot-specific layer; when the two disagree on anything substantive,
treat `AGENTS.md` as authoritative and flag the discrepancy.

## Why this file

GitHub Copilot CLI auto-loads `COPILOT.md` when it lives alongside
the agent-context files. Keeping it in `.agents/` next to
`AGENTS.md` means Copilot reads the same shared prose as
Codex / Cursor / Gemini / Claude Code without copy-pasting.

## Copilot-specific notes

- **Skills** — Copilot CLI auto-discovers skills from installed
  plugins; cross-reference `kickjs-skills.md` for available
  triggers in this project.
- **Tool naming** — Copilot's tool names differ from Claude Code's
  (`edit` vs `Edit`, `shell` vs `Bash`, etc.). The shared
  prose in `AGENTS.md` describes intents, not tool names; consult
  Copilot's docs for the concrete invocation.
- **Confirmation flows** — Copilot CLI surfaces destructive
  operations through an explicit approval gate. Stage edits with
  short, focused diffs so each one is easy to review at the prompt.

## Refreshing this file

`kick g agents --only copilot -f` regenerates this file from the
CLI template. Hand-edited content is overwritten — keep customisation
in `.agents/COPILOT.local.md`.
