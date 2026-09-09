/**
 * The page a visitor gets when there is no page.
 *
 * A site's 404 was `<h1>Not found</h1>` — no header, no footer, no theme, and
 * nothing to do next. That is a developer's 404 shown to somebody who mistyped
 * a URL or followed an old link, and it reads like the site is broken rather
 * than like the address is wrong.
 *
 * This is a page like any other: the site's own layout, the site's own colours,
 * a sentence in plain words, and a way back. It is built rather than stored,
 * so a site gets one without asking — and an author who wants their own writes
 * a page at `/404` and this steps aside.
 */
import { Page, SPEC_VERSION, SiteSpec } from "@forinda-cms/spec";

import { staticSource } from "./entries.js";
import { renderPage } from "./render.js";

export interface StatusPage {
  readonly status: number;
  readonly title: string;
  readonly message: string;
  /** Where "back" goes. The site root, unless somebody knows better. */
  readonly to?: string;
  readonly action?: string;
}

/** What each status says, in the words somebody outside this project would use. */
const WORDING: Record<number, { title: string; message: string }> = {
  404: {
    title: "We cannot find that page",
    message:
      "The link may be old, or the address may have a typo in it. Nothing is broken — the page simply is not here.",
  },
  500: {
    title: "Something went wrong at our end",
    message:
      "This is our fault, not yours. Try again in a moment; if it keeps happening, the site's owner will want to know.",
  },
  403: {
    title: "That page is not yours to see",
    message: "You may need to sign in, or this may belong to somebody else.",
  },
};

/** A page an author declared for this status, if they did. */
export function declaredStatusPage(spec: SiteSpec, status: number): Page | undefined {
  return spec.pages.find((page) => page.path === `/${status}` && page.draft !== true);
}

/**
 * A page for a status, in the site's own clothes.
 *
 * Synthesised as a `Page` rather than as HTML, so it renders through the same
 * layout, theme and blocks as everything else — a 404 that does not look like
 * the site is a 404 that looks like somebody else's error.
 */
export function statusPage(
  spec: SiteSpec,
  status: number,
  override: Partial<StatusPage> = {},
): Page {
  const words = WORDING[status] ?? {
    title: "Something is not right",
    message: "That did not work. Trying again may help.",
  };
  const title = override.title ?? words.title;
  const message = override.message ?? words.message;

  // Parsed rather than asserted: the schema fills the defaults every page has
  // and refuses this if it is ever written wrongly, which is what stops a
  // built-in page from being the one page that does not obey the rules.
  return Page.parse({
    key: `status-${status}`,
    path: `/${status}`,
    title,
    seo: { noindex: true },
    blocks: [
      {
        type: "section",
        style: { padding: { y: "xl", x: "lg" }, textAlign: "center" },
        children: [
          { type: "heading", attrs: { text: title, level: 1 }, style: { fontSize: "xl" } },
          { type: "text", attrs: { text: message } },
          {
            type: "button",
            attrs: { label: override.action ?? `Back to ${spec.name}`, to: override.to ?? "/" },
          },
        ],
      },
    ],
  });
}

/**
 * A status page for a server that cannot reach its own site.
 *
 * The 404 above is rendered in the site's clothes because the spec is right
 * there. A 500 is the case where it may not be: the commonest cause of one is
 * the database being unreachable, and the spec lives in the database — so an
 * error page that reads the spec is an error page that throws while explaining
 * that something threw.
 *
 * So this depends on nothing. A parsed spec with a name and the default theme,
 * through the same renderer, with the same wording: plainer than the site, but
 * a page rather than a stack trace, and it cannot fail for the reason the
 * request did.
 */
export function statusHtml(status: number, siteName = "This site"): string {
  const spec = SiteSpec.parse({
    specVersion: SPEC_VERSION,
    name: siteName,
    theme: {
      colors: { brand: "#1a56db", text: "#1a1a1a", background: "#ffffff", muted: "#6b7280" },
      fonts: { body: "system-ui" },
      typeScale: { sm: "0.9rem", md: "1rem", lg: "1.25rem", xl: "2rem" },
    },
    content: [],
    pages: [],
  });
  return renderPage(statusPage(spec, status), { spec, source: staticSource({}) }).html;
}
