---
layout: ../../layouts/Docs.astro
title: "Install — forinda-cms"
description: "Two files and one command. Migrations and the first owner are created on boot."
section: "Documentation"
previous: { href: "/docs/", label: "Overview" }
next: { href: "/docs/editing/", label: "Run your site" }
---

<!--
Installing.

The five-minute front door. WordPress won on this, and if it is harder here
the ownership argument stays theoretical — so the page is short, the command
count is low, and every prerequisite is stated before it is needed.
-->

# Install

<p class="lede">Two files, one command, no setup wizard.</p>

## What you need

<ul>
<li>A machine with Docker and Docker Compose. 1–2&nbsp;GB of memory is enough.</li>
<li>A few minutes. There is no account to create and nothing to license.</li>
</ul>

<p class="muted">No Docker? <a href="#without-docker">Node and a Postgres URL are enough</a>.</p>

## Install

<div class="snippet">
<header><span>terminal</span><button class="copy" type="button" data-copy="mkdir my-site &amp;&amp; cd my-site
curl -O https://forinda-cms.netlify.app/install/compose.yaml
curl -o .env https://forinda-cms.netlify.app/install/env.example">Copy</button></header>
<pre><code>mkdir my-site && cd my-site
curl -O https://forinda-cms.netlify.app/install/compose.yaml
curl -o .env https://forinda-cms.netlify.app/install/env.example</code></pre>
</div>

Open <code>.env</code> and set three things:

<table>
<tbody>
<tr><td><code>POSTGRES_PASSWORD</code></td><td>Anything long and random. There is no default on purpose.</td></tr>
<tr><td><code>OWNER_EMAIL</code></td><td>Your sign-in.</td></tr>
<tr><td><code>OWNER_PASSWORD</code></td><td>At least 12 characters.</td></tr>
</tbody>
</table>

<div class="snippet">
<header><span>terminal</span><button class="copy" type="button" data-copy="docker compose up -d">Copy</button></header>
<pre><code>docker compose up -d</code></pre>
</div>

Open <code>http://localhost:8080</code>. There is a working site, and your dashboard is at <code>/admin</code>. Sign in and it asks what kind of site this is — bookings, enquiries, or nothing yet — and gives you a real one to start from.

<div class="note">

<strong>There is no migration step and no setup command.</strong> The app migrates its own database and creates the first owner on boot, so <code>up</code> reaches a working site rather than a page telling you to run something else. Booting again changes nothing — migrations keep their ledger in the database, and the owner is created once.

</div>

<h2 id="without-docker">Without Docker</h2>

Docker is the default because it brings the database and a version to pin along with it. It is not a requirement. If you have Node 22 or newer and a Postgres database somewhere — a VPS, a managed one, the one your host already gave you — this is the whole install:

<div class="snippet">
<header><span>terminal</span><button class="copy" type="button" data-copy="DATABASE_URL=postgres://user:pass@localhost:5432/forinda \
OWNER_EMAIL=you@example.com OWNER_PASSWORD=a-long-enough-password \
npx forinda-cms">Copy</button></header>
<pre><code>DATABASE_URL=postgres://user:pass@localhost:5432/forinda \
OWNER_EMAIL=you@example.com OWNER_PASSWORD=a-long-enough-password \
npx forinda-cms</code></pre>
</div>

It migrates the database, creates the owner once, and serves on <code>PORT</code> (8080 by default). <code>npx forinda-cms --help</code> lists everything it reads — the same variables the compose file sets.

<div class="note">

<strong>What this path does not bring.</strong> No database, no TLS, no <code>backup.sh</code> — those came from compose. Put a reverse proxy in front of it for HTTPS, set <code>SECURE_COOKIES=true</code> and <code>TRUST_PROXY=true</code> behind one, point <code>MEDIA_DIR</code> at a directory that survives a redeploy, and take your own <code>pg_dump</code> backups.

</div>

## Putting it on the internet

Compose publishes the app on <code>HTTP_PORT</code> and deliberately does <em>not</em> publish Postgres. Put a TLS terminator in front — Caddy, nginx, a load balancer — and then set two more variables:

<table>
<tbody>
<tr>
<td><code>SECURE_COOKIES=true</code></td>
<td>Marks the session cookie Secure. Turn this on only once HTTPS works, or the
cookie never arrives and nobody can sign in.</td>
</tr>
<tr>
<td><code>PUBLIC_URL</code></td>
<td>Your address, e.g. <code>https://example.com</code>. Used for canonical URLs and
the sitemap.</td>
</tr>
<tr>
<td><code>TRUST_PROXY=true</code></td>
<td>Only with a proxy you control. It makes the app believe forwarded headers, which
is wrong for anything else.</td>
</tr>
</tbody>
</table>

## Upgrading

<div class="snippet">
<header><span>terminal</span><button class="copy" type="button" data-copy="docker compose pull &amp;&amp; docker compose up -d">Copy</button></header>
<pre><code>docker compose pull && docker compose up -d</code></pre>
</div>

Migrations are idempotent and resumable, so an interrupted upgrade is re-runnable rather than a state to reason about. Pin a version in <code>.env</code> if you would rather upgrade deliberately.

<div class="ctas">
<a class="cta" href="/docs/editing/">Next: run your site</a>
<a class="cta secondary" href="/docs/operating/">Backups</a>
</div>
