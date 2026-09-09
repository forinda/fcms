---
layout: ../../layouts/Docs.astro
title: "Build with it — forinda-cms"
description: "The spec as files under version control, the fcms CLI, the management API, and an MCP server for agents."
section: "Documentation"
previous: { href: "/docs/automations/", label: "Automations" }
next: { href: "/docs/operating/", label: "Keep it running" }
---

<!--
The other audience (doc 12).

Files, a CLI, an API and an MCP server — with the safety model stated plainly,
because the developer's first question about an agent-drivable CMS is what
stops it doing something stupid.
-->

# Build with it

<p class="lede">
The site is a directory of readable YAML. Put it in git, review changes in a pull
request, apply them from CI.
</p>

<pre><code>my-site/
site.yaml            name, theme, layout
content/service.yaml a content type per file
pages/home.yaml      a page per file
logic/confirm.yaml   an automation per file</code></pre>

<p><code>npx @forinda/fcms-cli init my-site</code> writes all of that, already
valid and already canonical. Every field type, block and operator the spec
accepts is listed in the <a href="/docs/reference/">reference</a>.</p>

## The CLI

<table>
<tbody>
<tr><td><code>fcms validate</code></td><td>Check the spec. Reports file, line and column.</td></tr>
<tr><td><code>fcms fmt</code></td><td>Rewrite every file canonically. <code>--check</code> in CI.</td></tr>
<tr><td><code>fcms dev</code></td><td>Serve it locally, reloading on save. No database needed.</td></tr>
<tr><td><code>fcms diff a b</code></td><td>Describe the difference between two spec directories in plain language.</td></tr>
<tr><td><code>fcms link</code> / <code>login</code></td><td>Point this directory at a site and sign in.</td></tr>
<tr><td><code>fcms plan</code></td><td>What applying these files would do. <strong>Exits 2 if anything is destructive</strong>, so CI can gate on it without parsing output.</td></tr>
<tr><td><code>fcms apply</code></td><td>Apply them. Destructive changes need <code>--yes</code>; <code>--content</code> also sends the rows back.</td></tr>
<tr><td><code>fcms pull</code></td><td>Write the live spec back out as canonical files. <code>--content</code> also writes every row to <code>data/&lt;type&gt;.yaml</code>.</td></tr>
</tbody>
</table>

<code>fcms login</code> stores a session token under your config directory, mode 0600, one per server. The link — which names the server and nothing secret — lives in <code>fcms.json</code> in the project and is safe to commit.

<div class="note">

There are deliberately <strong>no bulk content commands</strong>. Automating content belongs to the MCP server below; two machine doors for one audience is two surfaces to keep in step.

</div>

## Agents — the MCP server

<pre><code>&#123;
"mcpServers": &#123;
"forinda-cms": &#123; "command": "fcms-mcp", "args": ["/path/to/my-site"] &#125;
&#125;
&#125;</code></pre>

It exposes ten tools, and the list is the safety model:

<table>
<tbody>
<tr><td><code>site_status</code> <code>site_spec</code> <code>site_plan</code> <code>site_history</code></td><td>Read.</td></tr>
<tr><td><code>site_apply</code> <code>site_undo</code></td><td>Change the site. Destructive changes are refused unless confirmed.</td></tr>
<tr><td><code>entry_list</code> <code>entry_create</code> <code>entry_update</code> <code>entry_delete</code></td><td>Content.</td></tr>
</tbody>
</table>

There is no <code>write_file</code>, no <code>run_sql</code>, nothing that takes a path or a command. An agent describes the site it wants and the server works out the difference — so a model with a stale idea of your page cannot corrupt it, and everything it does lands in the same history with the same undo.

It authenticates with the session <code>fcms login</code> already stored, so an agent's access is a session you can see and revoke, not a permanent key.

## The API

Both of the above talk to the same five endpoints — <code>login</code>, <code>status</code>, <code>spec</code>, <code>plan</code>, <code>apply</code>, plus content — over HTTP with a bearer token. If you want to drive it from something else, that is the surface, and the client library is <code>@forinda-cms/sdk</code>.

## What the site publishes to machines

<code>/robots.txt</code>, <code>/sitemap.xml</code> and <code>/llms.txt</code> are generated from the spec, so none of them can go stale. The sitemap carries a <code>lastmod</code> taken from the row behind each page; <code>llms.txt</code> describes the site for a model rather than a crawler, from the same content types and pages you already wrote.

<pre><code>seo:
indexable: true   # false: every page noindex, robots.txt disallows, no sitemap
sitemap: true
llms: true

analytics:
gtag: G-ABC1234567</code></pre>

<p><code>indexable: false</code> is one switch for a staging copy or a site before launch, rather than <code>noindex</code> on every page and one forgotten.</p>

<div class="note">

There is <strong>no field for a pasted <code>&lt;script&gt;</code></strong>, and there will not be. A spec is data an agent may propose and a form may submit; arbitrary JavaScript in it is a cross-site scripting hole with an approval workflow in front of it. Analytics providers are named — Google, Plausible, Umami — and the snippet is ours.

</div>

## Extending it

Blocks, actions and availability kinds are registries, and a plugin adds to them. A plugin declares what it provides and what it needs, contributes block types, and never imports the engine, the database or a repository — what it gets is what a block gets, and the whole of its authority is the shape of that function:

<pre><code>import { definePlugin } from '@forinda-cms/plugin'

export default definePlugin({
manifest: {
name: 'acme-bookings',
version: '1.0.0',
api: '1',
provides: { blocks: ['acme-bookings-form'] },
capabilities: { network: ['api.acme.com'] },
},
blocks: [ /* the same shape core registers */ ],
})</code></pre>

Every contribution is namespaced to the plugin, so two plugins cannot collide and none can redefine what <code>form</code> means on a site that installs it. Today a plugin is a dependency plus one line — a code review and a deploy — which is a feature at this stage rather than a missing button: a block's <code>render</code> is code, and there will be no install-from-the-internet until the isolation behind it is real.

## Scripts inside an automation

A <code>script.run</code> step is JavaScript over the values a pipeline has, in a separate process with the filesystem, child processes and native modules denied at the runtime level, and no network, database or credentials in scope. It gets its input and returns a value; two seconds, a fixed heap, and a cap on what it may return. See <a href="/docs/automations/">automations</a>.

<div class="ctas">
<a class="cta" href="/docs/install/">Install it</a>
<a class="cta secondary" href="/docs/operating/">Backups and upgrades</a>
</div>
