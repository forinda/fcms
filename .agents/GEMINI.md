# GEMINI.md — forinda-cms

**Read `./AGENTS.md` first.** It is the canonical, multi-agent
reference for this project — every convention, structure, decorator
pattern, env wiring rule, generator usage. This file is a thin
Gemini-specific layer; when the two disagree on anything substantive,
treat `AGENTS.md` as authoritative and flag the discrepancy.

## Why this file

Gemini CLI auto-loads `GEMINI.md` when it lives alongside the
agent-context files. Keeping it in `.agents/` next to `AGENTS.md`
means Gemini reads the same shared prose as Codex / Cursor / Copilot
without us copy-pasting.

## Gemini-specific notes

- **Skills activation** — Gemini activates skills via
  `activate_skill` (its native MCP-style tool); the equivalent on
  Claude Code is the `Skill` tool. Cross-reference the
  `kickjs-skills.md` index for the available triggers.
- **Tool naming** — Gemini's tool names differ from Claude Code's
  (e.g. `read_file` vs `Read`, `run_terminal_command` vs
  `Bash`). The shared prose in `AGENTS.md` describes intents, not
  tool names; consult Gemini's docs for the concrete invocation.
- **File ops** — Gemini's file edits are sandboxed; large refactors
  may need explicit confirmation. Prefer the smallest-possible-edit
  pattern.

## Refreshing this file

`kick g agents --only gemini -f` regenerates this file from the
CLI template. Hand-edited content is overwritten — keep customisation
in `.agents/GEMINI.local.md`.
