/**
 * Where a form on the public site may send you afterwards: a path on this
 * site, or `/`.
 *
 * A form that sets a cookie *and* redirects wherever it is told is a phishing
 * primitive — a link that signs someone in and lands them on a page that looks
 * like the site.
 *
 * Decided by the parser a browser uses rather than by a pattern over the text.
 * A regex for "starts with one slash" let `/\evil.example` through, and
 * browsers read that backslash as a slash: `//evil.example`, another origin.
 * Resolved against a placeholder origin, anything that leaves it is refused,
 * however it is spelled, and what is returned is the parser's own path — not
 * the text that was asked for.
 */
const HERE = "https://same-site.invalid";

export function sameSitePath(asked: unknown): string {
  // A path, and no whitespace anywhere: parsers strip tabs and newlines
  // before following, which turns '/ok\n//evil' into something else.
  if (typeof asked !== "string" || !asked.startsWith("/") || /\s/.test(asked)) return "/";

  let url: URL;
  try {
    url = new URL(asked, HERE);
  } catch {
    return "/";
  }
  if (url.origin !== HERE) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}
