# fcms

The management CLI for [forinda-cms](https://forinda-cms.netlify.app). A site
is a directory of YAML; this is what checks it, previews it and publishes it.

```sh
npm install -g @forinda/fcms-cli
fcms --help
```

Or without installing anything — **with the scoped name**, because `fcms` on its
own is an unrelated package somebody else publishes:

```sh
npx @forinda/fcms-cli --help
```

## Without a server

These read the directory and nothing else — no network, no database, no
account:

|                   |                                                        |
| ----------------- | ------------------------------------------------------ |
| `fcms validate`   | Is this a valid site? What routes does it have?        |
| `fcms fmt`        | Rewrite every file in canonical form. `--check` in CI. |
| `fcms diff <dir>` | What changed between two versions of a site.           |
| `fcms dev`        | Serve it at `localhost:4321`, rebuilt on save.         |

## With one

These talk to a forinda-cms server over HTTP. They never touch its database.

|                   |                                                                               |
| ----------------- | ----------------------------------------------------------------------------- |
| `fcms link <url>` | Name the server this directory publishes to.                                  |
| `fcms login`      | Sign in. The token is stored `0600` in your home directory.                   |
| `fcms status`     | What that server currently has.                                               |
| `fcms pull`       | Write the server's site back out as files. `--content` for entries too.       |
| `fcms plan`       | What applying these files would change. Exits `2` if anything is destructive. |
| `fcms apply`      | Do it. Refuses destructive changes without `--yes`.                           |

`plan` and `apply` print what they are about to do before they do it, so
`--yes` is an informed answer rather than a blind one.

## Licence

**AGPL-3.0-or-later.** Run it, fork it, use it commercially. The obligation
lands in one case only: if you run a _modified_ version that other people reach
over a network, publish your changes.

This is a bundle — the renderer, the spec model, the YAML syntax and the HTTP
client are compiled into it. The last three are Apache-2.0 in their own right;
the renderer is not, which is what makes the bundle AGPL. `NOTICE` has the
breakdown, and a commercial licence is available for anyone the AGPL does not
suit.
