# Licensing

Two licences, and the line between them is "is this the product, or is this how
you talk to the product".

| | Licence | Why |
|---|---|---|
| The product — engine, admin, renderer, AI layer, database, and the `fcms` CLI | **AGPL-3.0-or-later** | Run it, fork it, sell services around it. If you run a modified version and let other people use it over a network, publish your changes. |
| The interop surface — `@forinda-cms/spec`, `@forinda-cms/lang`, `@forinda-cms/sdk`, `@forinda-cms/plugin` | **Apache-2.0** | The file format, the client and the plugin API are meant to be copied. Copyleft there would tax the ecosystem for nothing. |
| Your specs, your content, your themes, your plugins | **Yours** | Nothing here claims them. A CMS whose licence is vague about that is one nobody sensible builds on. |

## What the AGPL actually asks

Most people owe nothing beyond what they already do:

- **Self-hosting it, unmodified, for yourself or for clients** — nothing to
  publish. Run it, charge for running it, build a business on it.
- **Modifying it for your own internal use, not offered over a network** —
  nothing to publish.
- **Running a modified version that other people reach over a network** —
  publish those modifications under the AGPL. This is the whole point: the
  version you host is a version other people depend on, and they should be able
  to see and keep it.
- **Redistributing it, modified or not** — pass on the same licence and the
  source.

The obligation is to the *users of your instance*, not to us. Sending changes
upstream is welcome but not required.

## The commercial licence

The AGPL is a poor fit for some businesses — an embedded OEM deployment, a
platform that cannot publish its own modifications, a legal department with a
blanket copyleft ban. A commercial licence removes the AGPL's obligations for
those cases, in exchange for money rather than reciprocity.

Ask: <forinda82@gmail.com>.

This is possible only because one party holds the copyright to the whole work,
which is why contributions need a CLA before they can be merged (see
`CONTRIBUTING.md`). It is the price of dual licensing, and it is worth saying
out loud rather than surprising a contributor with it.

## Not legal advice

This file explains intent. `LICENSE` is the licence, and it governs. Neither
has been through a lawyer.
