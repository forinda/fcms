# CLAUDE.md — forinda-cms

**Read `./.agents/AGENTS.md` first.** It is the canonical, multi-agent
reference for this project (Claude, Copilot, Codex, Gemini, etc.) —
project conventions, structure, decorator patterns, env wiring, CLI
generators, every gotcha.

**Then browse `./.agents/skills/`.** Each subdirectory is a single
task-oriented skill (`add-module/`, `write-controller-test/`,
`bootstrap-export/`, `deny-list/`, …) containing a `SKILL.md`
with YAML frontmatter (`name`, `description`) and the recipe body.
The structure follows the Claude Code skills convention — agents that
auto-load skills from `.agents/skills/` will pick each up by its
frontmatter. Use this directory as the playbook when executing common
KickJS workflows.

This file is a thin Claude-specific layer on top of those two; when
they disagree on anything substantive, treat `.agents/AGENTS.md` as
authoritative and flag the discrepancy.

## Why `.agents/` + this thin pointer

`.agents/AGENTS.md` is what every agent reads (Codex, Cursor, Gemini,
Copilot, Aider, …) — one canonical source so the prose doesn't drift
across copies. `CLAUDE.md` is what Claude Code automatically loads as
project context on each conversation, so it stays at the project root.
Keeping CLAUDE.md slim and pointing at `.agents/` avoids two
out-of-sync copies of the same content. Per-agent files
(`.agents/GEMINI.md`, `.agents/COPILOT.md`) live alongside
`AGENTS.md` for tool-specific notes that don't belong in the shared
prose.

## Claude-specific notes

- **Slash commands** — `/help` for Claude Code commands; `/init`
  to refresh project memory if AGENTS.md changes substantially.
- **Feedback** — file issues at <https://github.com/anthropics/claude-code/issues>.
- **Persistent memory** — Claude maintains user/feedback/project/
  reference memories under `.claude/memory/`. If you ask for
  something that contradicts a remembered preference, Claude flags
  it before acting; corrections update memory automatically.
- **Long-running tasks** — `/loop` and `/schedule` for recurring
  or background work. Useful for "wait for the deploy then open a
  cleanup PR" or "every Monday triage the issue board" patterns.

## Quick reference (full version in .agents/AGENTS.md)

```bash
pnpm install            # Install dependencies
kick dev                 # Dev server with HMR + typegen
kick build && kick start # Production
pnpm run test           # Vitest
kick typecheck           # tsc/tsgo, whichever the project has
kick format              # oxfmt
```

## v4 framework reminders

When generating or modifying code in this project, stay aligned with the v4 conventions documented in `.agents/AGENTS.md`:

- **Adapters**: `defineAdapter()` factory — never `class implements AppAdapter`.
- **Plugins**: `definePlugin()` factory — never plain function returning `KickPlugin`.
- **DI tokens**: `<scope>/<PascalKey>[/<suffix>]` — scope is lowercase, the key segment is **PascalCase** (e.g. `'app/Users/repository'`, `'mycorp/Cache/redis'`). First-party uses the reserved `'kick/'` prefix; this project owns its own scope.
- **Decorators**: `@Controller()` (no path arg — mount prefix comes from `routes().path`).
- **HTTP runtime**: this app may run on Express, Fastify, or h3 — check `kick.config.ts` `runtime` (or `bootstrap({ runtime })`) before writing engine-specific code. Prefer engine-neutral `ctx` APIs (`ctx.json`/`ctx.body`/`ctx.params`/`ctx.sse`); don't assume `ctx.req` is an Express request. Uploads (`@FileUpload` → `ctx.file`/`ctx.files`) work on all three (`kick add upload` installs the driver). Full rules in `.agents/AGENTS.md` → "HTTP runtime".
- **Module entry file** MUST be named `<name>.module.ts` and live under `src/modules/<name>/`. The Vite plugin auto-discovers `*.module.[tj]sx?` for graceful HMR — a misnamed `projects.ts` silently degrades every save into a full restart.
- **Env**: schema lives in `src/config/index.ts`; `import './config'` MUST be the first import in `src/index.ts` (side-effect registers the schema before any `@Value` resolves).
- **Assets**: drop new template files into `src/templates/<namespace>/`; the dev watcher auto-rebuilds the `KickAssets` augmentation + `assets.x.y()` re-walks on next call. No restart, no manual build.
- **Context Contributors** (`defineContextDecorator`) over `@Middleware()` for ctx-population work.
- **Repos under tests**: `Container.create()` for isolation — never `new Container()` or `getInstance().reset()`.
- **Bootstrap export**: `src/index.ts` must end with `export const app = await bootstrap({ ... })`. The Vite plugin and `createTestApp` import the named `app`; without the export, HMR silently degrades to full restarts.
- **Thin entry file**: aggregate `modules`, `middlewares`, `plugins`, `adapters` in their own folders (`src/modules/index.ts`, `src/middleware/index.ts`, …) and pass them by name to `bootstrap()` — never inline the lists in `src/index.ts`.
- **Refresh these files**: `kick g agents -f` regenerates `CLAUDE.md` at the project root and `.agents/AGENTS.md` + `.agents/GEMINI.md` + `.agents/COPILOT.md` + every `.agents/skills/<name>/SKILL.md` from the latest CLI templates. Hand-edited content is overwritten — keep customisation in `.agents/AGENTS.local.md` or per-skill `SKILL.local.md` files alongside.

For everything else (controllers, services, modules, RequestContext API, generators, CLI commands, package additions, env wiring, troubleshooting) → `.agents/AGENTS.md`.
