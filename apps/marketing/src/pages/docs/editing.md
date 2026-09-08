---
layout: ../../layouts/Docs.astro
title: "Run your site — forinda-cms"
description: "The dashboard: content, the visual canvas, the assistant, and undo."
section: "Documentation"
previous: { href: "/docs/install/", label: "Install" }
next: { href: "/docs/automations/", label: "Automations" }
---

<!--
The dashboard, for the person whose business this is.

Written for someone who has never used a CMS: what each screen is for, when
to use which, and what the warnings mean. The destructive-change wording is
quoted exactly as the product says it, because a doc that paraphrases a
warning teaches people to skim the real one.
-->

# Run your site

<p class="lede">
Sign in at <code>/admin</code> on your own install. Everything below is that dashboard.
</p>

## The first time you sign in

A brand-new site asks one question: what kind of site is this? Pick <em>bookings</em>, <em>enquiries</em>, or <em>nothing yet</em>, and you get a real site — pages, a form that works, and somewhere to put what you store. Everything in it can be changed straight afterwards, and the choice is recorded in history like any other change, so it can be undone.

The question only appears while the site is still empty. Once it has anything in it, the front page becomes the dashboard below.

## What is waiting for you

The front page opens with <em>Needs you</em>: entries written but not published, automations that failed, payments a customer started and never finished, automations somebody turned off. Each line is a count and a link to the screen that deals with it. When there is nothing, it says so in one line and takes up no more room than that.

Under it are the site's latest automation runs and its latest changes — who changed what, from where, and how long ago — so "what happened while I was away" is answered without opening anything.

## Content

The front page also lists your content types — Services, Bookings, Stylists, whatever your site declares — with how many entries each has. Open one to list its entries, and use <em>Add</em> or <em>edit</em> to change them.

Fields that point at something offer it: a booking's service is a list of your services, a stylist's photo is a list of what you have uploaded, with the current one shown. Nothing asks you to type an identifier.

The form is generated from what the type declares, so it validates the way the site does: a required field left empty is refused rather than saved blank, a number field will not take words, and a slug already in use is reported as such instead of failing later.

Long lists stay usable: twenty-five at a time, newest first, with a search box that looks inside the entries themselves — a customer's name, a phone number — not only at their titles. You can show only drafts or only published, and order by name or by when something last changed. All of that lives in the address, so a filtered list is a link you can bookmark or send to somebody.

A new entry starts as a <strong>draft</strong> — written, saved, and not visible to the public. Publish it from the list when it is ready, and unpublish it to take it down without deleting it. The dashboard says how many of each type are waiting.

## What a type holds

A content type is the shape of a thing your site stores — a Service has a name, a price and a duration; a Booking has a customer, a date and a status. Under <em>Types</em> you can see every one your site has, and change what it holds.

Open a type and the fields are on the left, in the order they appear on the form. Select one to set its label, its help text, whether it is required, and whether the site can filter and sort by it. Add one by naming it and saying what it holds — a line of text, a number, a date, a file, a link to another entry, or a status that moves between values.

Two things are fixed once created: the type's key and a field's name. Those appear in addresses and in your pages, so renaming one is a change with your data inside it — the label above it is free to change whenever you like.

Removing a field removes what is stored in it. You are told exactly what that costs before anything happens — <em>"Whatever is stored in it for 6 existing services will be deleted"</em> — and nothing is removed until you press the second button. Either way it lands in <a href="/docs/operating/">history</a>, so it can be undone.

## Adding and removing pages

<em>Pages</em> lists every page, its address, and how many sections it has. Add one by giving it a title and an address — it starts empty and opens straight on the canvas, which is where sections go.

Each page has settings of its own: its address, whether it is still a draft (written, saved, not served to the public), whether it wears the site's header and footer, and how it appears in search results and when someone shares the link. A page can also be turned into a <em>detail page</em> — one address per entry of a type, like a page per service.

Deleting one is asked about twice, and the warning is specific: <em>"Anyone with that link, and any search result pointing at it, will stop working unless a redirect is set up."</em>

## The look of the site

<em>Settings</em> holds the site's name, its fonts, and its palette. Every colour on the site points at one of the colours listed there, so changing one changes it everywhere — that is the whole reason there is no colour picker on individual sections.

Beside each colour it says what would be affected: how many places use it, or that the site's own styles do. You can only remove one that nothing is using, which is why that button is sometimes greyed out.

## Pages — the canvas

Pages are edited on a canvas, not in a form. Open one and you get three panes: the structure on the left, <strong>your actual page</strong> in the middle, and the settings for whatever you have selected on the right.

<table>
<tbody>
<tr><td>↑ ↓</td><td>Move a section up or down.</td></tr>
<tr><td>→</td><td>Nest it inside the section above — how a group is made.</td></tr>
<tr><td>←</td><td>Move it back out.</td></tr>
<tr><td>⧉</td><td>Duplicate it, with everything inside it.</td></tr>
<tr><td>✕</td><td>Delete it.</td></tr>
</tbody>
</table>

Clicking something in the page itself selects it. The settings panel offers the choices that exist for that block — spacing, width, background, alignment — as options rather than as numbers and colour codes, so the site stays coherent when you change your mind about the brand later.

<div class="note">

The middle pane is not a preview. It is the page, rendered the way a visitor gets it. There is nothing that can look right here and wrong in public.

</div>

## What your site talks to

Under <em>Integrations</em>: the outside services your site uses — a payment account, a text-message account, somewhere to post to when something happens. Declared once here and named by automations and payments, so the list of places your data can go is a list you can read on one screen.

Each kind asks only for what it actually needs, and says which of them it still has nothing for. Credentials are the exception to "type it in here": a credential field takes the <strong>name</strong> of an environment variable on your server, never the key itself. The key stays on the machine, and your site's files stay safe to print, commit and hand to anyone. The screen will tell you whether the machine currently has a value under that name — which is usually the answer to why a payment will not start.

## Pictures

<strong>Media</strong> holds everything you have uploaded — pictures and PDFs, up to 10&nbsp;MB each. Upload one, describe it (that description is what a screen reader and a search engine read), and use its <code>asset:…</code> reference in an image or gallery block.

The same file uploaded twice is stored once, so duplicating a page costs nothing, and deleting one copy never breaks the other.

## The assistant

Describe a change in words — <em>"add a page listing our stylists, with their photos"</em> — and it writes a proposal. You then see exactly what would change, in plain language:

<pre><code>Adds a new Stylist type with 4 fields.
Adds a page at /stylists.
! Removes the Short description field from Service.
Whatever is stored in it for 12 existing services will be deleted.</code></pre>

Nothing happens until you press Apply. A line with <strong>!</strong> means something would be lost, and it says how much — read those twice. If a request cannot be expressed, it says so and explains what would be needed instead, which is a real answer rather than a failure.

The assistant needs an API key on your install. Without one it is switched off and everything else works normally.

## Things people send you

A content type can accept submissions from the site — reviews from people with an account, or enquiries from anyone. Everything that arrives is a <strong>draft</strong>: it is in your dashboard, and it is not on your site until you publish it.

That is the moderation. A form nobody can post to without appearing in a queue first cannot be defaced by a script that found it, and you never have to take something down that was already up.

## Sections you use more than once

Select a section on the canvas and save it as a <em>component</em>. It stays where it was, and you can place it on other pages — editing it changes all of them, which is the whole point and the reason copy-and-paste is not the same thing. A placed component shows how many pages carry it before you change anything.

## Automations

Under <em>Automations</em>: say when something should happen and what should happen next — confirm a booking when its deposit lands, text the customer when it is confirmed. You can try one without doing it for real, and every run is listed with what each step did. <a href="/docs/automations/">The full page is here.</a>

## History and undo

Every change — yours, a colleague's, the assistant's, or one made from the command line — is one entry in <em>History</em>, newest first, saying who made it and which surface it came through. The most recent one can be undone with a button.

Undo is exact, not a guess: the reverse of each change is recorded at the moment it is made. That is also why deleting something asks for confirmation rather than warning you afterwards.

<div class="ctas">
<a class="cta" href="/docs/developers/">Next: build with it</a>
<a class="cta secondary" href="/docs/operating/">Backups and upgrades</a>
</div>
