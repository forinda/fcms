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
    raw(`<meta property="og:site_name" content="${esc(spec.name)}">`),
    raw(`<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`),
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
  // Don't append the site name to a page already named after the site — the
  // home page is usually titled "Riverside Salon", and "Riverside Salon —
  // Riverside Salon" is what a template does when nobody looks at the output.
  const title = seo?.title
    ? resolve(seo.title, scope)
    : page.title === spec.name
      ? page.title
      : `${page.title} — ${spec.name}`;
  const description = seo?.description ? resolve(seo.description, scope) : undefined;
  const image = seo?.image ? resolve(seo.image, scope) : undefined;
  return {
    title,
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    // A draft page is noindex whatever its own setting says.
    noindex: page.draft || (seo?.noindex ?? false),
  };
}
