# fcms-mcp

The machine door to a [forinda-cms](https://fcms.kickjs.app) site: ten
MCP tools an agent can use to read a site's spec, propose a change, apply it,
and undo it.

```json
{
  "mcpServers": {
    "fcms": { "command": "npx", "args": ["-y", "@forinda/fcms-mcp"] }
  }
}
```

Run it from a directory that `fcms link` has already linked and `fcms login` has
a live token for — the same credentials the CLI uses, so a developer who can use
one can use the other without a second secret. `FCMS_URL` and `FCMS_TOKEN`
override, for an agent that never ran the CLI.

It takes the site root as an optional argument and otherwise uses the working
directory, so the configuration above needs no path and works on any machine.

## The tools

|                                                                 |                                                    |
| --------------------------------------------------------------- | -------------------------------------------------- |
| `site_status`                                                   | What the site has right now                        |
| `site_spec`                                                     | Read the whole spec                                |
| `site_plan`                                                     | What a change would do, before it does it          |
| `site_apply`                                                    | Do it — destructive changes refused unless allowed |
| `site_history`                                                  | What has changed, and who changed it               |
| `site_undo`                                                     | Undo the last change                               |
| `entry_list` / `entry_create` / `entry_update` / `entry_delete` | The rows                                           |

Every change goes through the same validate → diff → classify → gate path as the
admin and the CLI, and every one of them is recorded with an inverse. An agent
cannot reach the database, and it cannot make a change a person cannot see or
undo.

## Licence

AGPL-3.0-or-later. See `NOTICE` for what is inside the bundle.
