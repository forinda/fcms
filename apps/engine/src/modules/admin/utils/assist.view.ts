/**
 * The assistant's screen.
 *
 * What the owner reads is the **diff**, never the YAML. ADR 0002's exit test is
 * a non-developer reading five diffs and saying what each would do; a screen
 * that shows a specification instead has failed that test before it is run.
 *
 * The spec still travels through the page in a hidden field, because the thing
 * applied must be the thing shown (see the controller). It is never displayed.
 */
import type { SpecChange } from "@forinda-cms/spec";

import type { Suggestion } from "../use-cases/assist.usecase";
import { esc } from "./view";

export interface AssistOptions {
  readonly available: boolean;
  readonly instruction?: string | undefined;
  readonly suggestion?: Suggestion | undefined;
  readonly refused?: string | undefined;
}

export function assist(options: AssistOptions): string {
  const { available, instruction = "", suggestion, refused } = options;

  const form = `<form method="post" action="/admin/assist">
  <div class="field">
    <label for="instruction">What would you like to change?</label>
    <textarea id="instruction" name="instruction" rows="3"
      placeholder="Add a page listing our stylists, with their photos."
      ${available ? "" : "disabled"}>${esc(instruction)}</textarea>
    <p class="help">It writes a proposal. Nothing changes until you say so.</p>
  </div>
  <div class="actions"><button type="submit"${available ? "" : " disabled"}>Ask</button></div>
</form>`;

  return `<h1>Assistant</h1>
${available ? "" : offline()}
${form}
${refused ? `<p class="error">${esc(refused)}</p>` : ""}
${suggestion ? result(suggestion, instruction) : ""}`;
}

/**
 * No key, and the rest of the CMS is unaffected.
 *
 * Worth stating plainly rather than hiding the screen: an owner who cannot find
 * the feature assumes it is broken, and ADR 0011 §3 is a promise that this is a
 * configuration rather than a degraded product.
 */
function offline(): string {
  return `<p class="muted">The assistant needs an API key
    (<code>ANTHROPIC_API_KEY</code>) and this install has none. Everything else —
    the canvas, content, the CLI — works without it.</p>`;
}

function result(suggestion: Suggestion, instruction: string): string {
  switch (suggestion.kind) {
    case "unavailable":
      return `<p class="error">${esc(suggestion.reason)}</p>`;

    case "declined":
      // An answer, not a failure (ADR 0018 §4). Rendering this as an error
      // teaches owners to rephrase until the model invents something.
      return `<h2>That cannot be done with a specification</h2>
        <p>${esc(suggestion.reason)}</p>`;

    case "invalid":
      return `<h2>The proposal was not usable</h2>
        <p class="muted">${esc(suggestion.detail)}</p>
        <p class="help">Try describing the change differently, or in smaller steps.</p>`;

    case "spec":
      return proposal(suggestion, instruction);
  }
}

function proposal(suggestion: Extract<Suggestion, { kind: "spec" }>, instruction: string): string {
  const { changes, destructive, yaml, initial } = suggestion;

  if (changes.length === 0 && !initial) {
    return `<h2>Nothing would change</h2>
      <p class="help">The site already matches what was asked for.</p>`;
  }

  const lines = changes.map((change: SpecChange) =>
    change.classification === "destructive"
      ? `<li class="destructive-change"><strong>${esc(change.summary)}</strong>${
          change.impact ? `<br><span class="warn">${esc(change.impact)}</span>` : ""
        }</li>`
      : `<li>${esc(change.summary)}</li>`,
  );

  return `<h2>This is what would change</h2>
<ul class="changes">${lines.join("\n")}</ul>
${
  destructive > 0
    ? `<p class="error">${destructive} of these would lose something. Read them again before agreeing.</p>`
    : ""
}
<form method="post" action="/admin/assist/apply">
  <input type="hidden" name="instruction" value="${esc(instruction)}">
  <input type="hidden" name="spec" value="${esc(yaml)}">
  ${destructive > 0 ? '<input type="hidden" name="confirm" value="true">' : ""}
  <div class="actions">
    <button type="submit"${destructive > 0 ? ' class="destructive"' : ""}>
      ${destructive > 0 ? "Apply anyway" : "Apply"}
    </button>
    <a href="/admin/assist" class="muted">Discard</a>
  </div>
  <p class="help">You can undo this from history afterwards.</p>
</form>`;
}
