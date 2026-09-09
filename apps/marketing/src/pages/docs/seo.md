---
layout: ../../layouts/Docs.astro
title: "Getting found — forinda-cms"
description: "Titles, structured data, sitemaps, llms.txt and automatic redirects — generated from the spec, not from a plugin you configure."
section: "Documentation"
previous: { href: "/docs/editing/", label: "Run your site" }
next: { href: "/docs/automations/", label: "Automations" }
---

<!--
SEO, for the person whose business this is — and the developer checking what
the platform actually emits.

The argument of this page is the one thing WordPress cannot answer: SEO here is
not a plugin that asks you questions, because the content model already knows.
-->

# Getting found

<p class="lede">
Search engines, share previews and now language models all read your site
before a person does. All three are generated from the spec, so there is nothing
to configure and nothing to keep in step.
</p>

<div class="note">

**Why there is no SEO plugin.** WordPress has no typed content model, so Yoast
and Rank Math must ask you, per post, per post type, "is this a Recipe?" — and
map every field by hand. Here the content type already declares its shape once,
so every entry of it emits correct markup forever. Zero-config structured data
is not a feature that can be retrofitted; it falls out of having a spec.

</div>

## What every page already emits

Nothing below needs turning on.

<table>
<tbody>
<tr><td><code>&lt;title&gt;</code> and <code>meta description</code></td><td>From the page, resolved per entry on a collection page.</td></tr>
<tr><td><code>link rel="canonical"</code></td><td>This page's own address — so two URLs for one room are not two pages.</td></tr>
<tr><td><code>html lang</code> and <code>og:locale</code></td><td>Your <code>locale</code>. A screen reader picks its voice from the first; a crawler picks its market.</td></tr>
<tr><td>Open Graph</td><td><code>og:title</code>, <code>og:description</code>, <code>og:image</code>, <code>og:image:alt</code>, <code>og:url</code>, <code>og:type</code>, <code>og:site_name</code>.</td></tr>
<tr><td>Twitter/X</td><td><code>twitter:card</code> — large image when there is one — plus title, description and image.</td></tr>
<tr><td>JSON-LD</td><td>When the content type declares a <code>jsonld</code> mapping. See below.</td></tr>
<tr><td><code>noindex</code></td><td>On drafts, automatically. A page nobody has published is a page nobody should find.</td></tr>
</tbody>
</table>

## Titles and descriptions

A page can say its own, and they are templates — so one collection page gives
every entry of a type a distinct title without editing them one at a time:

<pre><code>key: property-detail
path: /stay
collection: { from: property }
seo:
title: "&#123;&#123; entry.name &#125;&#125; in &#123;&#123; entry.city &#125;&#125;"
description: "&#123;&#123; entry.summary &#125;&#125;"
image: "asset:hero"
noindex: false</code></pre>

<p>Leave <code>title</code> out and the page's own title is used, with the site's name appended — except on a page already named after the site, because "Riverside Salon — Riverside Salon" is what a template does when nobody looks at the output.</p>

## Structured data

A content type maps schema.org properties to its own fields, once:

<pre><code>key: property
label: Property
jsonld:
type: Hotel
properties:
name: name
description: summary
image: photo
priceRange: price</code></pre>

<p>Every entry of that type then emits valid JSON-LD — the markup that produces a rich result rather than a blue link. <code>Article</code>, <code>BlogPosting</code>, <code>Event</code>, <code>Product</code>, <code>Service</code>, <code>LocalBusiness</code>, <code>Person</code>, <code>Organization</code>, <code>Recipe</code>, <code>JobPosting</code>, <code>FAQPage</code>, <code>Review</code>, and for travel <code>Hotel</code>, <code>LodgingBusiness</code>, <code>Place</code>, <code>TouristAttraction</code>, <code>Restaurant</code>. A hotel marked up as a <code>LocalBusiness</code> is a hotel search engines do not know is a hotel.</p>

## Addresses, and moving them

<p>A content type's <code>permalink</code> is the URL shape for its entries — <code>/stay/&#123;&#123; entry.slug &#125;&#125;</code>. Change a page's path and <strong>the old one 301s to the new one automatically</strong>: the change was recorded with its inverse, so the platform knows where that address used to point without anyone writing a redirect rule.</p>

<p>It only redirects when the page still exists somewhere else. A deleted page has nowhere to send anyone, and pointing it at the homepage tells a search engine that content moved when it did not — worse than an honest 404.</p>

## robots.txt, sitemap.xml, llms.txt

Three files nobody writes.

<table>
<tbody>
<tr><td><code>/robots.txt</code></td><td>Points at the sitemap. No <code>Disallow</code> rules you did not ask for.</td></tr>
<tr><td><code>/sitemap.xml</code></td><td>Every public page, each with a <code>lastmod</code> from the row behind it — so a crawler can tell what changed without refetching the site.</td></tr>
<tr><td><code>/llms.txt</code></td><td>What this site is, for a model rather than a crawler: the summary, the pages, and what each content type holds.</td></tr>
</tbody>
</table>

<p>Drafts and <code>noindex</code> pages are in none of them. Set <code>PUBLIC_URL</code> so canonicals and the sitemap carry absolute addresses.</p>

## Switching it off

<pre><code>seo:
indexable: true   # false: every page noindex, robots.txt disallows, no sitemap
sitemap: true
llms: true</code></pre>

<p><code>indexable: false</code> is the switch for a staging copy, a client's site before launch, or an internal tool — one decision at the level it is actually made, rather than <code>noindex</code> on every page and one forgotten on the page that matters. It lives in the spec, so a staging copy made by applying the same files cannot quietly become indexable.</p>

<p><code>llms.txt</code> is not gated on <code>indexable</code>, because they are different questions: a site kept out of search may still be one an agent has been pointed at deliberately.</p>

## Analytics

<pre><code>analytics:
gtag: G-ABC1234567          # Google Analytics 4
plausible: example.com      # the domain it counts under
umami: &#123; id: "…", src: "https://umami.example/script.js" &#125;</code></pre>

<div class="note">

There is **no field for a pasted `<script>`**, and there will not be. A spec is
data an agent may propose and a form may submit; arbitrary JavaScript in it is a
cross-site scripting hole with an approval workflow in front of it. Providers
are named and the snippet is ours.

</div>

<div class="ctas">
<a class="cta" href="/docs/editing/">Run your site</a>
<a class="cta secondary" href="/docs/developers/">Build with it</a>
</div>
