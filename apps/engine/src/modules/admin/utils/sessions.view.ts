/**
 * Every way in, listed.
 *
 * The screen answers one question — *"is anything signed in that should not
 * be?"* — so it shows what a person can actually judge: what kind of client it
 * is, from where, and when it was last used. A session id and a token hash
 * answer nothing.
 */
import type { SessionView } from "../use-cases/sessions.usecase";

import { esc } from "./view";

export function sessions(rows: readonly SessionView[]): string {
  const others = rows.filter((row) => !row.current).length;

  const list = rows
    .map(
      (row) => `<tr${row.current ? ' class="current"' : ""}>
  <td>${esc(row.what)}${row.current ? ' <span class="pill">this one</span>' : ""}</td>
  <td class="muted">${esc(row.where)}</td>
  <td class="muted">${esc(ago(row.lastUsed))}</td>
  <td class="muted">${esc(row.started.toISOString().slice(0, 10))}</td>
  <td>${
    row.current
      ? ""
      : `<form method="post" action="/admin/sessions/${esc(row.id)}/revoke">
           <button class="link destructive" type="submit">Revoke</button>
         </form>`
  }</td>
</tr>`,
    )
    .join("\n");

  return `<h1>Sessions</h1>
<p class="muted">Everywhere you are signed in — browsers, and the command line or an
agent using <code>fcms login</code>. Revoking one takes effect immediately.</p>

<table>
  <thead><tr><th>What</th><th>Where</th><th>Last used</th><th>Started</th><th></th></tr></thead>
  <tbody>${list}</tbody>
</table>

${
  others > 0
    ? `<form method="post" action="/admin/sessions/revoke-others" class="danger">
  <button class="destructive" type="submit">Sign out everywhere else (${others})</button>
  <p class="help">Keeps this session. Use it if a device was lost, or if a token may have leaked.</p>
</form>`
    : '<p class="help">Nothing else is signed in.</p>'
}`;
}

/**
 * "Four minutes ago", not a timestamp.
 *
 * The question is whether a session is in use *now*; a reader converting an
 * ISO string into that answer is a reader who gets it wrong.
 */
function ago(when: Date | null): string {
  if (!when) return "not since it was opened";

  const seconds = Math.max(0, Math.floor((Date.now() - when.getTime()) / 1000));
  if (seconds < 90) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;

  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}
