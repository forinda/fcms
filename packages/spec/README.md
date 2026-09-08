# @forinda-cms/spec

The site spec — the AST that every authoring surface writes to.

Chat, the visual canvas, the YAML language, the CLI and any external AI harness
all reduce to a patch against this schema. The YAML profile is _surface syntax
over these types_, which is what makes the syntax swappable and this package
foundational.

## Layout

| File            | Section                                                     |
| --------------- | ----------------------------------------------------------- |
| `primitives.ts` | Keys, prefixed references, the template language            |
| `style.ts`      | Theme tokens, and the 16 tier-2 style props                 |
| `condition.ts`  | The `{field, op, value}` triple used by `when` and `where`  |
| `query.ts`      | `data` — bounded queries                                    |
| `content.ts`    | Content types, fields, `state`                              |
| `pages.ts`      | Routes, the block tree, `flow`, per-page SEO                |
| `logic.ts`      | Trigger + ordered steps                                     |
| `access.ts`     | Roles over content types                                    |
| `wiring.ts`     | Integrations, secrets by reference                          |
| `site.ts`       | The whole document                                          |
| `patch.ts`      | Patch, inverse, and the additive/destructive classification |

## The one rule

**No construct in here may express computation.** Not a loop, not an expression
string, not a function call. If a change cannot be described in one English
sentence a non-developer can verify, it is not a spec change — it is
vocabulary, and vocabulary comes from a plugin.

Every time this schema grows, check the addition against that sentence.
