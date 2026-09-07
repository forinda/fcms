---
layout: ../../layouts/Docs.astro
title: "Automations — forinda-cms"
description: "Say when something should happen and what should happen. Try it before it is real, and read every run afterwards."
section: "Documentation"
previous: { href: "/docs/editing/", label: "Run your site" }
next: { href: "/docs/developers/", label: "Build with it" }
---

<!--
Automations, for the person whose business this is.

Written around what an owner actually wants to happen — "text them when the
deposit lands" — rather than around the vocabulary. Every claim is something
the product does today, and the two things it deliberately refuses (many
recipients, a script that can reach the world) are stated as decisions rather
than gaps, because they are.
-->

# Automations

<p class="lede">
An automation is <strong>when something happens</strong> and <strong>what should happen
next</strong>. Confirm a booking when the deposit lands. Text the customer when it is
confirmed. Post new enquiries to your team chat at nine every morning.
</p>

They live at <code>/admin/automations</code>. You build them on the same kind of screen as your pages: the steps on the left, what each step needs on the right, and what it would do in the middle.

## When it runs

<table>
<tbody>
<tr><td><strong>Something is created</strong></td><td>A booking arrives, an enquiry is submitted.</td></tr>
<tr><td><strong>Something changes</strong></td><td>Any edit to a row of that type.</td></tr>
<tr><td><strong>Something changes status</strong></td><td>A booking becomes <em>confirmed</em> — and you can name which status.</td></tr>
<tr><td><strong>A payment succeeds</strong></td><td>Only when the platform has confirmed it with the provider, never because someone said so.</td></tr>
<tr><td><strong>On a schedule</strong></td><td>Five-field cron, in UTC. <code>0 9 * * *</code> is nine every morning.</td></tr>
<tr><td><strong>Someone finishes a journey</strong></td><td>The last step of a multi-step booking flow.</td></tr>
</tbody>
</table>

## What can happen

<table>
<tbody>
<tr><td><code>entry.transition</code></td><td>Move something along a status it already declares — pending to confirmed. It will not jump to a status the type does not allow.</td></tr>
<tr><td><code>webhook.post</code></td><td>Post it to somewhere you have declared: your chat, your automation tool, your own system.</td></tr>
<tr><td><code>http.request</code></td><td>Call a service you have declared, and keep what it answered for a later step.</td></tr>
<tr><td><code>sms.send</code> · <code>email.send</code></td><td>Text or email <em>one</em> person.</td></tr>
<tr><td><code>script.run</code></td><td>Work something out in JavaScript when the steps above cannot.</td></tr>
</tbody>
</table>

## Passing values along

Give a step a name and the ones after it can read what it produced. Anywhere a step takes a value, you can write it in double braces:

<pre><code>{{ entry.customerName }}      the thing that triggered it
{{ steps.customer.body.id }}  what an earlier step answered
{{ site.name }}               your site</code></pre>

That is the whole language. There is no arithmetic, no functions and no conditions in it — on purpose. It is the same tiny language your pages use, and it cannot grow into something nobody can review. When you genuinely need to calculate, that is what the script step is for.

## Try it before it is real

Press <strong>Try it</strong>. Every step that would touch the outside world tells you what it <em>would</em> have done and does nothing:

<pre><code>webhook.post: would have posted to chat
entry.transition: would have moved from pending to confirmed</code></pre>

It refuses rather than pretending, deliberately. A test that invented a fake response would run the rest of your automation on the invention and then report success for something that has never happened.

## Reading what happened

Every run is listed with what each step did. A failed step is retried five times over about ten minutes, and then it stops with the reason on it — <em>“the SMS was not accepted (InsufficientBalance)”</em>. An automation that quietly stopped working is worse than one you never made, so nothing fails silently.

## Sending messages

Declare an SMS or email account under integrations, and the automation names it. Until you have an account with a provider, use <code>provider: preview</code> — the message is written onto the run and marked <strong>not delivered</strong>, so you can build and read the whole thing before you can send anything.

<strong>One recipient per step.</strong> There is no "send to everyone who matches", and that is a decision rather than a missing feature: an automation that texts every row is something you build once, by accident, and then explain to your customers and your provider.

## The script step

When you need real calculation — split a total by line item, work out VAT, reshape what a service answered — a script step runs JavaScript over the values the pipeline has:

<pre><code>const net = input.lines.reduce((sum, l) => sum + l.amount, 0)
return { net, vat: Math.round(net * 0.16) }</code></pre>

It runs in a separate process that <strong>cannot reach anything</strong>: no network, no files, no database, no access to your integrations' credentials, and no memory between runs. If it needs data, an earlier step fetches it; if something must be sent, a later step sends it. It gets two seconds and a fixed amount of memory, and a script that runs long is stopped.

That is the point rather than a limitation. Code that cannot reach anything is code you can let an assistant write for you.

<div class="ctas">
<a class="cta" href="/docs/editing/">Run your site</a>
<a class="cta secondary" href="/docs/developers/">Build with it</a>
</div>
