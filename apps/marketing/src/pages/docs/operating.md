---
layout: ../../layouts/Docs.astro
title: "Keep it running — forinda-cms"
description: "Backups, restores, upgrades, and what to check when something is wrong."
section: "Documentation"
previous: { href: "/docs/developers/", label: "Build with it" }
---

<!--
Keeping it running.

Backups first, because the export promise on the pricing page is only worth
something if the command is written down where an operator will find it.
-->

# Keep it running

<p class="lede">
Backups you can read, an upgrade that is one command, and what to do on the day
something is wrong.
</p>

## Backups

<div class="snippet">
<header><span>terminal</span><button class="copy" type="button" data-copy="./backup.sh                     # backups/forinda-cms-&lt;timestamp&gt;.sql.gz
./backup.sh restore &lt;file&gt;      # asks before replacing anything">Copy</button></header>
<pre><code>./backup.sh                     # backups/forinda-cms-&lt;timestamp&gt;.sql.gz
./backup.sh restore &lt;file&gt;      # asks before replacing anything</code></pre>
</div>

A plain <code>pg_dump</code> that any Postgres can read — the spec, its entire change history, and your content. No account, no export queue, no format only this software understands.

Restoring stops the app first so nothing writes mid-restore, and asks you to type the database name. It is the one command here that can lose data, and it should be hard to run by accident.

Uploaded media lives on disk rather than in Postgres, and the backup covers both — a backup that restores the site without its pictures is one you find out about at the worst moment.

There is a second, different export: <code>fcms pull --content</code> writes the spec <em>and</em> every row as readable files you can commit to git, edit by hand, and send back with <code>fcms apply --content</code>. It is not a replacement for the dump above — it holds no history and no media — but it is the copy you can actually read, diff and review.

## Upgrading

<div class="snippet">
<header><span>terminal</span><button class="copy" type="button" data-copy="docker compose pull &amp;&amp; docker compose up -d">Copy</button></header>
<pre><code>docker compose pull && docker compose up -d</code></pre>
</div>

Migrations run on boot and are idempotent and resumable, so an interrupted upgrade is re-runnable. Take a backup first anyway — it costs one command.

## When something is wrong

<table>
<tbody>
<tr>
<td><strong>Nobody can sign in</strong></td>
<td>Usually <code>SECURE_COOKIES=true</code> without working HTTPS: the browser is
told to send the session cookie only over TLS, so it never arrives.</td>
</tr>
<tr>
<td><strong>Postgres will not start after an upgrade</strong></td>
<td>Check the data volume is mounted at <code>/var/lib/postgresql</code>. Postgres 18
images refuse to start on a volume laid out for older ones.</td>
</tr>
<tr>
<td><strong>A change did something unexpected</strong></td>
<td>Undo it from History. Then read the entry — it says who made it and through which
surface.</td>
</tr>
<tr>
<td><strong>The assistant is off</strong></td>
<td>No <code>ANTHROPIC_API_KEY</code> on the install. Everything else keeps working;
that is deliberate.</td>
</tr>
<tr>
<td><strong>The site is up but a page 404s</strong></td>
<td>Check the entry is published — a draft is saved but not served — and that the
address is what you think. A moved page redirects from its old address
automatically; a page never published has no address at all.</td>
</tr>
</tbody>
</table>

## If a token or a laptop goes missing

<strong>Sessions</strong> in the dashboard lists everywhere you are signed in — browsers, and any terminal or agent that ran <code>fcms login</code> — with what each is and when it was last used. Revoke one, or sign out everywhere else in a single click. Revoking takes effect on the next request.

Sign-in is rate limited: ten failures in fifteen minutes, counted per account <em>and</em> per address, then a short wait. The counter clears the moment a correct password is used, so mistyping yours a few times costs nothing.

## Moving off

Take a dump, stand the compose file up somewhere else, restore. That is the whole procedure, and it works the same whether you are moving between your own machines or away from anything we ever host.
