# @forinda-cms/spec

The site spec — the AST that every authoring surface writes to.

Chat, the visual canvas, the YAML language, the CLI and any external AI harness
all reduce to a patch against this schema (research/11 §1). The YAML profile
(ADR 0006) is _surface syntax over these types_, which is what makes the syntax
swappable and this package foundational.

## Layout

| File            | Section                                                     | Decided by            |
| --------------- | ----------------------------------------------------------- | --------------------- |
| `primitives.ts` | Keys, prefixed references, the template language            | ADR 0001, ADR 0006    |
| `style.ts`      | Theme tokens, and the 16 tier-2 style props                 | ADR 0004, doc 07      |
| `condition.ts`  | The `{field, op, value}` triple used by `when` and `where`  | ADR 0009 §2           |
| `query.ts`      | `data` — bounded queries                                    | ADR 0009 §1           |
| `content.ts`    | Content types, fields, `state`                              | ADR 0001, ADR 0009 §4 |
| `pages.ts`      | Routes, the block tree, `flow`, per-page SEO                | ADR 0009 §3, doc 08   |
| `logic.ts`      | Trigger + ordered steps                                     | ADR 0001              |
| `access.ts`     | Roles over content types                                    | ADR 0008              |
| `wiring.ts`     | Integrations, secrets by reference                          | ADR 0001              |
| `site.ts`       | The whole document                                          | —                     |
| `patch.ts`      | Patch, inverse, and the additive/destructive classification | doc 03                |

## The one rule

**No construct in here may express computation.** Not a loop, not an expression
string, not a function call. If a change cannot be described in one English
sentence a non-developer can verify, it is not a spec change (ADR 0001) — it is
vocabulary, and vocabulary comes from a plugin.

Every time this schema grows, check the addition against that sentence.
