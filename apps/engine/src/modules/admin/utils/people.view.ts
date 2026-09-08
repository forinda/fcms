/**
 * Who can sign in (ADR 0041).
 *
 * A table and a form. What makes it worth its own screen is the column that
 * says what each role can do in words — "Entries and pictures" rather than
 * "editor" — because the person choosing is deciding what somebody else is
 * trusted with, and an enum name is not enough to decide that on.
 */
import type { OwnerRow } from "@forinda-cms/db";

import { ROLES, ROLE_LABELS, roleOf, type Role } from "@/shared/roles";
import { esc } from "./view";

export interface PeopleOptions {
  readonly people: readonly OwnerRow[];
  readonly actor: OwnerRow;
  readonly error?: string | undefined;
}

export function people({ people: rows, actor, error }: PeopleOptions): string {
  const row = (person: OwnerRow) => {
    const role = roleOf(person.role);
    const self = person.id === actor.id;

    return `<tr${self ? ' class="current"' : ""}>
  <td>${esc(person.name || person.email)}${self ? ' <span class="pill">you</span>' : ""}
    <div class="muted">${esc(person.email)}</div></td>
  <td>
    ${
      self
        ? `<span class="muted">${esc(ROLE_LABELS[role])}</span>`
        : `<form method="post" action="/admin/people/${esc(person.id)}/role" class="inline-role">
      <label class="sr-only" for="role-${esc(person.id)}">Role for ${esc(person.email)}</label>
      <select id="role-${esc(person.id)}" name="role">
        ${ROLES.map(
          (r) =>
            `<option value="${r}"${r === role ? " selected" : ""}>${esc(ROLE_LABELS[r])}</option>`,
        ).join("")}
      </select>
      <button class="link" type="submit">Change</button>
    </form>`
    }
  </td>
  <td class="muted">${esc(person.lastSeenAt ? when(person.lastSeenAt) : "never signed in")}</td>
  <td>${
    self
      ? ""
      : `<form method="post" action="/admin/people/${esc(person.id)}/delete" class="inline">
      <button class="link destructive" type="submit">Remove</button>
    </form>`
  }</td>
</tr>`;
  };

  return `${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
<h1>People</h1>
<p class="muted">Everybody who can sign in to this site, and what each of them may change.
Somebody's sessions end the moment their account is removed.</p>

<table>
  <caption class="sr-only">People who can sign in</caption>
  <thead><tr><th scope="col">Who</th><th scope="col">May</th><th scope="col">Last seen</th>
    <th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
  <tbody>${rows.map(row).join("")}</tbody>
</table>

<form method="post" action="/admin/people" class="new-type">
  <h2>Add somebody</h2>
  <div class="field">
    <label for="p-email">Email</label>
    <input id="p-email" name="email" type="email" required autocomplete="off">
  </div>
  <div class="field">
    <label for="p-name">Name</label>
    <input id="p-name" name="name" autocomplete="off">
  </div>
  <div class="field">
    <label for="p-role">They may</label>
    <select id="p-role" name="role">
      ${ROLES.filter((r) => r !== "owner")
        .map(
          (r) =>
            `<option value="${r}"${r === "editor" ? " selected" : ""}>${esc(ROLE_LABELS[r])}</option>`,
        )
        .join("")}
      <option value="owner">${esc(ROLE_LABELS["owner" as Role])}</option>
    </select>
  </div>
  <div class="field">
    <label for="p-password">First password</label>
    <input id="p-password" name="password" type="password" required minlength="12"
      autocomplete="new-password" aria-describedby="p-password-help">
    <p class="help" id="p-password-help">At least 12 characters. Hand it over however you
      normally would; they can change it once they are in.</p>
  </div>
  <div class="actions"><button type="submit">Add them</button></div>
</form>`;
}

/** Relative up to a week, a date after that — the same as the dashboard. */
function when(at: Date): string {
  const hours = Math.round((Date.now() - at.getTime()) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return days <= 7 ? `${days} ${days === 1 ? "day" : "days"} ago` : at.toISOString().slice(0, 10);
}
