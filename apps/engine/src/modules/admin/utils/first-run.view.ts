/**
 * The first screen of a new install (ADR 0036).
 *
 * It used to say "No site yet." and stop. Everything else in the admin 404s
 * without a spec, so that sentence was the whole product for anyone who had
 * just run `docker compose up` — true, and a dead end.
 *
 * Now it asks the only question worth asking at that moment: what kind of site
 * is this? Each answer is a real spec, applied the same way every other change
 * is, and every one of them can be changed afterwards — which the screen says,
 * because "choose carefully" is the wrong feeling for a first screen.
 */
import type { Starter } from "@/shared/starters";

import { esc } from "./view";

export interface FirstRunOptions {
  readonly siteName: string;
  readonly starters: readonly Starter[];
  readonly error?: string | undefined;
}

/**
 * Is this site still the one boot made?
 *
 * The installer applies the blank starter so `docker compose up` reaches a
 * working site rather than a 404 — which means "no spec" is not the state an
 * owner actually arrives in. This is: a home page, nothing stored, nothing
 * automated. The picker is offered while that holds and disappears the moment
 * anything is real — so it cannot overwrite work.
 */
export function untouched(spec: {
  content: readonly unknown[];
  pages: readonly unknown[];
  logic: readonly unknown[];
}): boolean {
  return spec.content.length === 0 && spec.logic.length === 0 && spec.pages.length <= 1;
}

export function firstRun({ siteName, starters, error }: FirstRunOptions): string {
  const card = (
    starter: Starter,
  ) => `<form method="post" action="/admin/start" class="card starter">
  <input type="hidden" name="starter" value="${esc(starter.key)}">
  <h3>${esc(starter.label)}</h3>
  <p class="muted">${esc(starter.summary)}</p>
  <ul>${starter.gives.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
  <button type="submit">Start with this</button>
</form>`;

  return `${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
<h1>${esc(siteName)} is empty</h1>
<p class="lede">Pick something to start from. Every one of these is a real site you can
change immediately — the pages, what it stores, all of it. Nothing here is decided for good.</p>

<div class="cards starters">${starters.map(card).join("")}</div>

<h2>Or describe it</h2>
<p class="muted">If you would rather say what the site is in your own words, the
<a href="/admin/assist">assistant</a> can propose one — though it wants something to change,
so most people start from one of the above and go from there.</p>`;
}
