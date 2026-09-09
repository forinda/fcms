/**
 * What a site publishes to things that are not people: an analytics tag, and a
 * description of itself for a model rather than a crawler.
 */
import { collectionType, type SiteSpec } from "@forinda-cms/spec";

import { esc, fragment, raw, type Html } from "./html.js";

/**
 * The analytics tag, if the site asked for one.
 *
 * Each provider is written out here rather than pasted into the spec, because a
 * spec is data a model may propose and a form may submit — see the note on
 * `SiteSpec.analytics`. The values that do reach the page are escaped anyway;
 * the schema already constrains them to an id, a domain and a URL.
 */
export function analytics(spec: SiteSpec): Html | null {
  const a = spec.analytics;
  if (!a) return null;

  const tags: Html[] = [];

  if (a.gtag) {
    const id = esc(a.gtag);
    tags.push(
      raw(`<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>`),
      // gtag needs its initialiser inline; this is ours, with one id
      // interpolated, not a snippet somebody pasted.
      raw(
        `<script>window.dataLayer=window.dataLayer||[];` +
          `function gtag(){dataLayer.push(arguments)}` +
          `gtag('js',new Date());gtag('config','${id}')</script>`,
      ),
    );
  }

  if (a.plausible) {
    tags.push(
      raw(
        `<script defer data-domain="${esc(a.plausible)}" ` +
          `src="https://plausible.io/js/script.js"></script>`,
      ),
    );
  }

  if (a.umami) {
    tags.push(
      raw(`<script defer data-website-id="${esc(a.umami.id)}" src="${esc(a.umami.src)}"></script>`),
    );
  }

  return tags.length > 0 ? fragment(...tags) : null;
}

/** Strip the markup a note may contain, and keep it to one line. */
function line(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * `/llms.txt` — the site described for something reading rather than crawling.
 *
 * The convention is a markdown file at the root: a title, a one-line summary,
 * and lists of links. Every part of it is already in the spec, which is the
 * argument for generating it: a hand-written one is out of date the first time
 * somebody adds a page, and this one cannot be.
 *
 * Draft and noindex pages are left out, on the same reasoning as the sitemap —
 * a page a crawler may not see is not a page an agent should be pointed at.
 */
export function llmsTxt(spec: SiteSpec, base?: string): string {
  const prefix = base ? base.replace(/\/$/, "") : "";
  const out: string[] = [`# ${spec.name}`];

  if (spec.note) out.push("", `> ${line(spec.note)}`);

  const pages = spec.pages
    .filter((p) => !p.draft && p.seo?.noindex !== true)
    .sort((a, b) => a.path.localeCompare(b.path));

  if (pages.length > 0) {
    out.push("", "## Pages");
    for (const page of pages) {
      // A collection page's title is a template resolved per row, and there is
      // no row here — so name it by what it lists instead of emitting braces.
      const type = page.collection
        ? spec.content.find((t) => t.key === collectionType(page.collection))
        : undefined;
      const title = type ? (type.labelPlural ?? type.label) : page.title;
      const note = page.note ? `: ${line(page.note)}` : type ? `: every ${type.label}` : "";
      out.push(`- [${title}](${prefix}${page.path})${note}`);
    }
  }

  if (spec.content.length > 0) {
    out.push("", "## Content");
    for (const type of spec.content) {
      const fields = type.fields.map((f) => f.name).join(", ");
      out.push(`- **${type.labelPlural ?? type.label}** — ${fields}`);
    }
  }

  return out.join("\n") + "\n";
}
