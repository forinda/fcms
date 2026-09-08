/**
 * Your own account (ADR 0042).
 *
 * Two forms and one sentence of consequence. The sentence matters: changing a
 * password signs out everything else holding a session — another browser, a
 * terminal that ran `fcms login`, the MCP server — and somebody should read
 * that before they press the button rather than notice it afterwards.
 */
import type { OwnerRow } from "@forinda-cms/db";

import { ROLE_LABELS, roleOf } from "@/shared/roles";
import { esc } from "./view";

export interface AccountOptions {
  readonly actor: OwnerRow;
  readonly error?: string | undefined;
  readonly done?: string | undefined;
}

export function account({ actor, error, done }: AccountOptions): string {
  return `${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
${done ? `<p class="ok" role="status">${esc(done)}</p>` : ""}
<h1>Your account</h1>
<p class="muted"><code>${esc(actor.email)}</code> <span class="sep">·</span>
  ${esc(ROLE_LABELS[roleOf(actor.role)])}</p>

<form method="post" action="/admin/account">
  <div class="field">
    <label for="a-name">Your name</label>
    <input id="a-name" name="name" value="${esc(actor.name ?? "")}" aria-describedby="a-name-help">
    <p class="help" id="a-name-help">What other people on this site see beside your address.</p>
  </div>
  <div class="actions"><button type="submit">Save</button></div>
</form>

<form method="post" action="/admin/account/password">
  <h2>Change your password</h2>
  <div class="field">
    <label for="a-current">Current password</label>
    <input id="a-current" name="current" type="password" required autocomplete="current-password">
  </div>
  <div class="field">
    <label for="a-next">New password</label>
    <input id="a-next" name="next" type="password" required minlength="12"
      autocomplete="new-password" aria-describedby="a-next-help">
    <p class="help" id="a-next-help">At least 12 characters.</p>
  </div>
  <div class="field">
    <label for="a-confirm">New password again</label>
    <input id="a-confirm" name="confirm" type="password" required minlength="12"
      autocomplete="new-password">
  </div>
  <p class="help">Changing it signs out everywhere else — another browser, a phone, a
    terminal that ran <code>fcms login</code>. This one stays signed in.</p>
  <div class="actions"><button type="submit">Change it</button></div>
</form>

<p class="muted"><a href="/admin/sessions">See where you are signed in</a>. Your address cannot
  be changed here — it is how you sign in, and it is what the history records beside everything
  you have done.</p>`;
}
