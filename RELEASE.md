# Releasing

One tag publishes everything.

```sh
pnpm release             # the next number for this year
pnpm release 2026.4.0    # that one
pnpm release --dry-run   # say what would happen, change nothing
```

`scripts/release.mjs` refuses more than it does, because a published npm
version is permanent: wrong branch, dirty tree, disagreement with
`origin/main`, a malformed or already-used tag, or a failing `pnpm verify`.
Then it shows you what will be published and the commits since the last
release, and asks. The tag is all it writes.

That runs [`.github/workflows/release.yaml`](.github/workflows/release.yaml):

| Published | Where | Tags |
|---|---|---|
| The image | `ghcr.io/forinda/fcms` | `2026.4.0`, `2026.4`, `2026`, `latest`, the commit sha |
| The server | [`@forinda/fcms-core`](https://www.npmjs.com/package/@forinda/fcms-core) on npm | `2026.4.0` |
| The CLI | [`@forinda/fcms-cli`](https://www.npmjs.com/package/@forinda/fcms-cli) on npm | `2026.4.0` |
| The MCP server | [`@forinda/fcms-mcp`](https://www.npmjs.com/package/@forinda/fcms-mcp) on npm | `2026.4.0` |

A merge to `main` republishes the image as `:edge` and **publishes nothing to
npm** — an npm version is permanent, and `edge` is a moving target.

## Versions

The server and the CLI carry the same number on purpose: one is the client of
the other, so `fcms 2026.4.0` goes with `@forinda/fcms-core 2026.4.0` and there is no
compatibility table to read.

The number is calendar versioning — `YYYY.N.P`: the year, a release counting
from 1 within it, and a patch. The count restarts each January, so the first
release of 2027 is `2027.1.0`.

`pnpm release` writes it into every manifest, commits that as
`chore(release): <version>`, and tags the commit. So a checkout says what it is
without anybody going to look at the tags, and a local `pnpm pack` produces a
tarball named after the version it actually holds.

The third number is not decoration. npm rejects anything that is not full
semver, and `npm version 2026.1` fails with `Invalid version: 2026.1` — after
the image has already been pushed, which is the worst half of a release to
have.

CI still runs `npm version` from the tag before publishing, with
`--allow-same-version`. That is a no-op when the manifests already agree, and it
is what keeps a tag pushed by hand publishing the right number.

The libraries — `@forinda-cms/spec`, `@forinda-cms/lang`, `@forinda-cms/sdk`
and `@forinda-cms/plugin` — will use semver when they ship, because they are
things other people build against.

## What ships

**`@forinda/fcms-core`** is assembled rather than written: the engine bundle, the
database migrations and the built admin application are copied into it at pack
time, so one `npx @forinda/fcms-core` has everything it needs and no workspace.

`@electric-sql/pglite` must stay a **dependency** and stay out of the bundle. It
is the embedded Postgres, and its WebAssembly data file is resolved relative to
its own package — inlined, it resolves beside `dist/index.js` and the first boot
dies on `ENOENT: pglite.data`. That is only visible from an installed tarball,
so `npm pack` and run it before trusting a change to the engine's externals.

**`@forinda/fcms-cli`** and **`@forinda/fcms-mcp`** are each a single bundled
file, built by the same `scripts/bundle.mjs`: the workspace packages they import
are compiled in, and the real npm dependencies stay external so npm can install
and patch them normally. The bundler takes its entry point from `bin`, its
externals from `dependencies` and its version from the manifest, so a package
that publishes a binary says so once.

Both ship a sourcemap. A bug report from somebody else's server is a stack
trace and nothing else, and without a map it names a line in a bundle nobody
has. The map embeds the TypeScript it was built from — which is this
repository, under a licence that says you may read it.

Both are built by `prepack`, so what a maintainer publishes and what CI
publishes are produced the same way. CI also builds the CLI bundle and runs it
against `examples/salon` on every pull request — the source tree and the bundle
can break apart, and only the bundle is what you get.

Check a tarball before trusting a change to it:

```sh
pnpm build
cd packages/server && pnpm pack --pack-destination /tmp
tar -tzf /tmp/forinda-cms-core-*.tgz
```

**Use pnpm, not npm, to pack or publish.** Dependencies are written `catalog:`
(one version per dependency for the whole workspace) and only pnpm rewrites
those into real version ranges as it packs. `npm publish` would ship the literal
string `catalog:` as every dependency's version and every install would fail.

## Publishing setup

npm **trusted publishing** (OIDC) rather than a token: the workflow proves its
identity to npm, so there is no secret to leak or rotate. Each tarball carries
provenance — the signed statement linking it to the commit and the run that
built it, and the "Verified" badge on the package page.

Once for each of `@forinda/fcms-core`, `@forinda/fcms-cli` and
`@forinda/fcms-mcp`:

1. Sign in to npm as the maintainer.
2. `https://www.npmjs.com/package/<name>/access` → **Trusted publishers** →
   **Add** → GitHub Actions.
3. Repository `forinda/fcms`, workflow `.github/workflows/release.yaml`,
   environment blank.

The very first publish of each cannot use OIDC, because the rule is registered
against a package that does not exist yet. Publish once from a maintainer's
machine with `pnpm publish --access public`, add the trusted publisher, and
every release after that belongs to the workflow.

## Licences on what ships

All three published packages are **AGPL-3.0-or-later**. The interop
packages, when they ship, are **Apache-2.0**. Each tarball carries its own
`LICENSE`, and the CLI carries a `NOTICE` naming which packages inside its
bundle are Apache-2.0 — that file is the only place a user can learn it, so it
ships whether or not the bundle changed. [`LICENSING.md`](LICENSING.md) has the
rest.

## Changelogs

The [releases page](https://github.com/forinda/fcms/releases) is the changelog,
written by `scripts/notes.mjs` from the commits between one tag and the last.
Commits are conventional (`feat(cli): …`), so the notes group themselves into
Features, Fixes and the rest with nothing to maintain by hand — anything with an
unrecognised prefix lands under "Other" rather than being dropped, because a
commit that fell out of the notes over a typo is worse than an untidy heading.
`!` after the type puts it under **Breaking**, first.

Preview them before tagging:

```sh
pnpm notes
```

There is deliberately no `CHANGELOG.md`. It would have to be committed *after*
the tag it describes — either an unreviewed commit on top of a release, or a
file that is permanently one release stale.

## The site

<https://forinda-cms.netlify.app> is not part of a tag. It builds from `main` on
every push, using [`netlify.toml`](netlify.toml) at the repository root. It also
serves the install files the quickstart downloads, copied from
[`install/`](install/) at build time — a release note saying "install with this
command" is only true if the file that command fetches is already there.
