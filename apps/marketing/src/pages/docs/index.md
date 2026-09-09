---
layout: ../../layouts/Docs.astro
title: "Documentation — forinda-cms"
description: "Install it, run your site, and drive it from files, an agent or an assistant."
section: "Documentation"
next: { href: "/docs/install/", label: "Install" }
---

<!--
The documentation index.

Ordered by what someone is trying to do, not by how the software is built:
install it, use it, build with it, keep it. Doc 12 says the two audiences
arrive here through different doors and neither should have to read the
other's half to get started.
-->

# Documentation

<p class="lede">
Two paths through this. If you are setting up a site for a business, read the first
three. If you are building for someone else, read all five.
</p>

<div class="cards">
<div class="card">

### <a href="/docs/install/">1 · Install</a>

Two files and one command. What you need, what happens on first boot, and how to put it behind a domain.

</div>
<div class="card">

### <a href="/docs/editing/">2 · Run your site</a>

The dashboard: content, the visual canvas, the assistant, history and undo — and what each is for.

</div>
<div class="card">

### <a href="/docs/automations/">3 · Make things happen</a>

Confirm a booking when the deposit lands, text the customer when it is confirmed — and try it before it is real.

</div>
<div class="card">

### <a href="/docs/developers/">4 · Build with it</a>

The spec as files, <code>fcms</code>, the API, and the MCP server for agents.

</div>
<div class="card">

### <a href="/docs/reference/">Reference</a>

Every field type, every block, every operator — generated from the schema, so it
cannot describe a version that does not exist.

</div>
<div class="card">

### <a href="/docs/operating/">5 · Keep it running</a>

Backups and restores, upgrades, and what to do when something is wrong.

</div>
</div>

## The one idea

Everything else follows from this: <strong>your site is a spec</strong> — one declarative document describing content types, pages, logic, access and integrations. It is not a database of settings and it is not code.

Every way of changing your site edits that same document, through the same validation and the same history:

<pre><code>forms · canvas · assistant · fcms · MCP
│
▼
the site spec
│
validate → describe → confirm if destructive → apply with an inverse
│
▼
your site, and one undoable history</code></pre>

So a change made by an agent at 2am and a change you make on your phone are the same kind of thing, appear in the same list, and undo the same way.
