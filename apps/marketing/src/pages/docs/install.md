---
layout: ../../layouts/Docs.astro
title: "Install — forinda-cms"
description: "One command, and no database to set up. Migrations and the first owner are created on boot."
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

<p class="lede">One command, no database to set up, no setup wizard.</p>

## What you need

<ul>
<li>Node 22 or newer. That is the entire list.</li>
<li>A few minutes. There is no account to create and nothing to license.</li>
</ul>

## Start a project

<div class="managers">
<input type="radio" name="install" id="install-pnpm" class="pm-pnpm" checked hidden>
<input type="radio" name="install" id="install-npm" class="pm-npm" hidden>
<input type="radio" name="install" id="install-yarn" class="pm-yarn" hidden>
<input type="radio" name="install" id="install-bun" class="pm-bun" hidden>
<header><span class="prompt">&gt;_</span><div class="tabs"><label for="install-pnpm">pnpm</label><label for="install-npm">npm</label><label for="install-yarn">yarn</label><label for="install-bun">bun</label></div></header>
<div class="panel panel-pnpm"><button class="copy" type="button" data-copy="pnpm dlx @forinda/fcms-cli init my-site
cd my-site && pnpm install
pnpm start">Copy</button><pre><code>pnpm dlx @forinda/fcms-cli init my-site
cd my-site &amp;&amp; pnpm install
pnpm start</code></pre></div>
<div class="panel panel-npm"><button class="copy" type="button" data-copy="npx @forinda/fcms-cli init my-site
cd my-site && npm install
npm run start">Copy</button><pre><code>npx @forinda/fcms-cli init my-site
cd my-site &amp;&amp; npm install
npm run start</code></pre></div>
<div class="panel panel-yarn"><button class="copy" type="button" data-copy="yarn dlx @forinda/fcms-cli init my-site
cd my-site && yarn
yarn start">Copy</button><pre><code>yarn dlx @forinda/fcms-cli init my-site
cd my-site &amp;&amp; yarn
yarn start</code></pre></div>
<div class="panel panel-bun"><button class="copy" type="button" data-copy="bunx @forinda/fcms-cli init my-site
cd my-site && bun install
bun run start">Copy</button><pre><code>bunx @forinda/fcms-cli init my-site
cd my-site &amp;&amp; bun install
bun run start</code></pre></div>
</div>

That writes a site you can already run — a spec that validates, a
<code>package.json</code>, and a <code>.gitignore</code> that keeps the database
out of version control. The next steps it prints come back in whichever
manager you used, too.

<strong>Postgres runs inside the process</strong> — the real thing, compiled to
WebAssembly — and keeps its data in <code>.fcms</code>. Nothing to install,
nothing listening but the site itself, and a backup is <code>cp -r .fcms</code>.

<p class="muted">Prefer to run Postgres as a service, or already have one?
<a href="#with-docker">Docker Compose</a> and
<a href="#without-docker">a connection string</a> both work, and the schema is
the same either way.</p>

<h2 id="with-docker">With Docker</h2>

Docker brings the database and a version to pin along with it, which is what
you want once one process is not enough. It needs Docker Compose and about
1–2&nbsp;GB of memory.

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

<h2 id="without-docker">Against a Postgres you already have</h2>

The same server, pointed at a database somebody else runs — a VPS, a managed one, the one your host already gave you. Same schema and same migrations as the embedded one, so moving between them is <code>pg_dump</code> and one variable:

<div class="snippet">
<header><span>terminal</span><button class="copy" type="button" data-copy="DATABASE_URL=postgres://user:pass@localhost:5432/forinda \
OWNER_EMAIL=you@example.com OWNER_PASSWORD=a-long-enough-password \
npx @forinda/fcms-core">Copy</button></header>
<pre><code>DATABASE_URL=postgres://user:pass@localhost:5432/forinda \
OWNER_EMAIL=you@example.com OWNER_PASSWORD=a-long-enough-password \
npx @forinda/fcms-core</code></pre>
</div>

A <code>postgres://</code> URL is a server; anything else is a directory to keep files in. <code>npx @forinda/fcms-core --help</code> lists everything it reads.

This is also the way past the embedded database's ceiling: it serves one query at a time, which is invisible for a business taking bookings and a wall under real traffic.

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
