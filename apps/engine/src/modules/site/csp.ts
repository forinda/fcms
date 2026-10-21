/**
 * The public site's Content-Security-Policy.
 *
 * The second line behind sanitising richtext: if markup that runs ever gets
 * past the sanitiser — or an entry finds another way onto a page — the
 * browser refuses to run it. Scripts and styles are allowed by this
 * response's nonce, which the renderer stamps on every tag it emits and
 * nothing in an entry can know; `'strict-dynamic'` lets a nonced analytics
 * loader add the scripts it needs and trusts nothing else. `https:` and
 * `'unsafe-inline'` are only for browsers too old for nonces — any that
 * understands one ignores both (CSP3).
 *
 * The site, not the admin: the admin's pages escape what they show, and its
 * UI libraries inject styles at runtime, so it gets a policy of its own once
 * those are accounted for. The canvas previews the *site*, framed, so that
 * frame carries this policy.
 */
import { randomBytes } from "node:crypto";

export const newNonce = (): string => randomBytes(16).toString("base64");

export function sitePolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'`,
    `style-src 'self' 'nonce-${nonce}'`,
    // Pictures from anywhere an owner links one; fonts and beacons likewise.
    "img-src 'self' https: data:",
    "font-src 'self' https: data:",
    "connect-src 'self' https:",
    // The map block's embed, and nothing else framed.
    "frame-src https://www.openstreetmap.org",
    // Replaces `X-Frame-Options: SAMEORIGIN`: the canvas frames the site, and
    // nobody else may.
    "frame-ancestors 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join("; ");
}
