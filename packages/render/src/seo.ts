/**
 * Head tags and JSON-LD.
 *
 * The JSON-LD half is doc 08's differentiator, and it is worth being precise
 * about why: **WordPress has no typed content model**, so Yoast and Rank Math
 * must ask the author to pick "this post is a Recipe" and map fields by hand,
 * per post type, per plugin. Here the content type already declares the mapping
 * once (`jsonld` in the schema), so every entry emits correct structured data
 * forever. Zero-config structured data is not a feature WordPress can retrofit —
 * it falls out of having a spec.
 */
import type { ContentType, SiteSpec } from "@forinda-cms/spec";

import { el, esc, fragment, raw, type Html } from "./html.js";
import type { Entry } from "./entries.js";
import { resolve } from "./scope.js";

export interface HeadInput {
  readonly spec: SiteSpec;
  readonly title: string;
  readonly description?: string;
  readonly canonical?: string;
  readonly image?: string;
  readonly noindex: boolean;
  readonly jsonld?: unknown;
  /** True on a page that is one row: an article rather than a section of a site. */
  readonly entry?: boolean;
}

/**
 * Serialise JSON-LD safely.
 *
 * `</script>` inside a JSON string ends the block early and everything after it
 * becomes markup — the classic injection through a data island. Entry content is
 * author- or visitor-supplied, so this escape is not optional.
 */
function jsonLdScript(data: unknown): Html {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return raw(`<script type="application/ld+json">${json}</script>`);
}

export function buildJsonLd(
  type: ContentType,
  entry: Entry,
  siteName: string,
): unknown | undefined {
  if (!type.jsonld) return undefined;
  const out: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": type.jsonld.type,
  };
  for (const [property, field] of Object.entries(type.jsonld.properties)) {
    const value = entry[field];
    if (value !== undefined && value !== null && value !== "") out[property] = value;
  }
  out["publisher"] = { "@type": "Organization", name: siteName };
  return out;
}

export function head(input: HeadInput): Html {
  const { spec, title, description, canonical, image, noindex, jsonld } = input;
  return fragment(
    raw('<meta charset="utf-8">'),
    // Non-negotiable at ~90% mobile access (doc 14). Without it a phone renders
    // the desktop layout scaled down and every responsive rule is inert.
    raw('<meta name="viewport" content="width=device-width, initial-scale=1">'),
    el("title", {}, title),
    description ? raw(`<meta name="description" content="${esc(description)}">`) : null,
    canonical ? raw(`<link rel="canonical" href="${esc(canonical)}">`) : null,
    // Drafts and previews must never be indexed — doc 08 lists this as
    // structural, and it is the cheapest half of SEO to get wrong.
    noindex ? raw('<meta name="robots" content="noindex,nofollow">') : null,
    raw(`<meta property="og:title" content="${esc(title)}">`),
    description ? raw(`<meta property="og:description" content="${esc(description)}">`) : null,
    image ? raw(`<meta property="og:image" content="${esc(image)}">`) : null,
    // The alt text of a shared card. A picture with no description is a picture
    // that says nothing to anybody who cannot see it, and a share is exactly
    // where that is read aloud.
    image ? raw(`<meta property="og:image:alt" content="${esc(title)}">`) : null,
    raw(`<meta property="og:site_name" content="${esc(spec.name)}">`),
    // Which address this is. Without it a share of `?utm_source=…` becomes its
    // own object with its own counts — the canonical link tells a crawler and
    // this tells everything else.
    canonical ? raw(`<meta property="og:url" content="${esc(canonical)}">`) : null,
    raw(`<meta property="og:type" content="${input.entry ? "article" : "website"}">`),
    // `en-US` in a meta tag is `en_US`, which is the sort of detail that is
    // wrong everywhere it is written out by hand.
    raw(`<meta property="og:locale" content="${esc(spec.locale.replace("-", "_"))}">`),
    raw(`<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`),
    // Twitter falls back to the Open Graph tags, and then does not, depending on
    // the year. Saying it twice costs three lines.
    raw(`<meta name="twitter:title" content="${esc(title)}">`),
    description ? raw(`<meta name="twitter:description" content="${esc(description)}">`) : null,
    image ? raw(`<meta name="twitter:image" content="${esc(image)}">`) : null,
    jsonld ? jsonLdScript(jsonld) : null,
  );
}

/** Resolve a page's SEO templates against the entry scope, with sane fallbacks. */
export function pageSeo(
  spec: SiteSpec,
  page: {
    title: string;
    seo?: { title?: string; description?: string; image?: string; noindex: boolean };
    draft: boolean;
  },
  scope: Record<string, unknown>,
): { title: string; description?: string; image?: string; noindex: boolean } {
  const seo = page.seo;
  // A site that says it is not indexable overrules every page: the switch
  // exists so nobody has to remember the page that matters.
  const siteBlocks = spec.seo.indexable === false;
  // A collection page's title is a template — `{{ entry.name }}` — and it was
  // being emitted literally, so every entry page on every site shared one
  // `<title>` reading `{{ entry.name }} — Riverside Rooms`. The `<h1>` beside
  // it resolved, because block attributes go through the scope and this did
  // not. Doc 08 makes titles most of what a crawler reads.
  const named = resolve(page.title, scope);
  // Don't append the site name to a page already named after the site — the
  // home page is usually titled "Riverside Salon", and "Riverside Salon —
  // Riverside Salon" is what a template does when nobody looks at the output.
  const title = seo?.title
    ? resolve(seo.title, scope)
    : named === spec.name
      ? named
      : `${named} — ${spec.name}`;
  const description = seo?.description ? resolve(seo.description, scope) : undefined;
  const image = seo?.image ? resolve(seo.image, scope) : undefined;
  return {
    title,
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    // A draft page is noindex whatever its own setting says, and so is every
    // page of a site that has said it is not indexable.
    noindex: siteBlocks || page.draft || (seo?.noindex ?? false),
  };
}
