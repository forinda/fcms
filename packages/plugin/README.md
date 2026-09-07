# @forinda-cms/plugin

The contract a plugin is written against.

A plugin contributes to registries the platform already has. It does not import
the engine, reach into the database, or hook arbitrary internals — it registers
blocks, and a block is a function from `BlockContext` to HTML. That narrowness
is the design (see ADR 0021): installing a plugin cannot change the meaning of a
page it did not write.

```ts
import { definePlugin } from "@forinda-cms/plugin";
import { el } from "@forinda-cms/render";

export default definePlugin({
  manifest: {
    name: "acme-bookings",
    version: "1.0.0",
    api: "1",
    provides: { blocks: ["acme-bookings-form"] },
    capabilities: { network: ["api.acme.com"], secrets: ["ACME_API_KEY"] },
  },
  blocks: [
    {
      name: "acme-bookings-form",
      summary: "Take a booking for a service.",
      attrs: ["service", "cta"],
      render: ({ className, attrs }) =>
        el("form", { class: className, method: "post" }, String(attrs.cta ?? "Book")),
    },
  ],
});
```

## The rules a mount enforces

- **`api` must be supported.** It is a single integer (ADR 0003) that moves only
  on a break to this contract. An unsupported one is refused by name rather than
  half-loaded.
- **Contributions are namespaced.** Every block name must start with the
  plugin's own name plus a hyphen. `acme-bookings` may register
  `acme-bookings-form`; it may not register `form`.
- **The manifest must match the code.** A block registered but not listed in
  `provides.blocks` does not mount, and a declaration with nothing behind it is
  an error. The manifest is what an owner is shown before install and what the
  capability diff compares between versions — it may not drift.
- **A refusal is not fatal.** `mountPlugins()` returns `{ registry, mounted,
refused }`. A broken plugin is dropped with a reason; the others still mount.

## What v1 is, plainly

A block's `render` is code and it runs in the engine's process. `capabilities`
is therefore **recorded and displayed, not enforced** — it ships now because a
capability history cannot be reconstructed later. Until the out-of-process
worker exists, mount first-party and audited plugins only. Installing one is a
dependency plus a line in the app's plugin list: a code review and a deploy.
