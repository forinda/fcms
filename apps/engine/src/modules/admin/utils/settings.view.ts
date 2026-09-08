/**
 * The site's own settings, and its theme (ADR 0035).
 *
 * The theme is tier 1 (ADR 0004): every colour on the site is a `token:` into
 * this list, so the swatches here are the site's whole palette and changing one
 * changes everything that uses it. That is why the controls are a handful of
 * colour inputs rather than a colour picker on every block — the second would
 * make "restyle the brand" impossible by making it unnecessary.
 */
import type { SiteSpec } from "@forinda-cms/spec";

import { esc } from "./view";

export interface SettingsOptions {
  readonly spec: SiteSpec;
  /**
   * What names each token — how many places in the spec, and whether the
   * site's own stylesheet reads it.
   */
  readonly usage: Readonly<Record<string, { count: number; base: boolean }>>;
  readonly error?: string | undefined;
}

const GROUPS = [
  {
    group: "colors" as const,
    heading: "Colours",
    blurb:
      "Every colour on the site points at one of these, so changing one here changes it everywhere.",
    example: "#1a7f5a",
  },
  {
    group: "typeScale" as const,
    heading: "Text sizes",
    blurb: "The steps text can be set at. A block chooses a step by name, never a number.",
    example: "1.25rem",
  },
  {
    group: "radius" as const,
    heading: "Corners",
    blurb: "How round a corner can be.",
    example: "8px",
  },
];

export function settings({ spec, usage, error }: SettingsOptions): string {
  const rows = (group: (typeof GROUPS)[number]) => {
    const tokens = spec.theme[group.group] ?? {};
    const names = Object.keys(tokens);
    if (names.length === 0) {
      return `<p class="muted">None yet.</p>`;
    }

    return `<ul class="tokens">${names
      .map((name) => {
        const value = String(tokens[name]);
        const used = usage[`${group.group}.${name}`] ?? { count: 0, base: false };
        const says = used.base
          ? "the site's own styles use it"
          : used.count === 0
            ? "not used yet"
            : `used in ${used.count} ${used.count === 1 ? "place" : "places"}`;
        const id = `t-${group.group}-${name}`;
        return `<li>
  <label for="${id}"><code>${esc(name)}</code></label>
  ${
    group.group === "colors"
      ? // The control is the swatch. A separate square beside it says the same
        // thing twice and drifts the moment someone changes one without saving.
        `<input id="${id}" name="token__${esc(group.group)}__${esc(name)}" type="color"
           value="${esc(value)}"><code class="muted">${esc(value)}</code>`
      : `<input id="${id}" name="token__${esc(group.group)}__${esc(name)}" value="${esc(value)}">`
  }
  <span class="muted">${esc(says)}</span>
  <button form="token-ops" name="op" value="remove:${esc(group.group)}:${esc(name)}"
    class="destructive" aria-label="Remove ${esc(name)}"${
      used.base || used.count > 0 ? " disabled" : ""
    }>
    <span aria-hidden="true">✕</span></button>
</li>`;
      })
      .join("")}</ul>`;
  };

  return `${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
<h1>Settings</h1>
<p class="muted">What the site is called, and the palette everything on it is drawn from.</p>

<form method="post" action="/admin/settings">
  <div class="field">
    <label for="s-name">Site name</label>
    <input id="s-name" name="name" value="${esc(spec.name)}" required>
  </div>

  <fieldset>
    <legend>Fonts</legend>
    <div class="field">
      <label for="s-body">Body</label>
      <input id="s-body" name="fontBody" value="${esc(spec.theme.fonts.body)}" required
        aria-describedby="s-body-help">
      <p class="help" id="s-body-help">A font family name, as CSS would take it — “Inter”.</p>
    </div>
    <div class="field">
      <label for="s-heading">Headings</label>
      <input id="s-heading" name="fontHeading" value="${esc(spec.theme.fonts.heading ?? "")}">
      <p class="help">Optional. Headings use the body font when this is empty.</p>
    </div>
    <div class="field">
      <label for="s-mono">Code</label>
      <input id="s-mono" name="fontMono" value="${esc(spec.theme.fonts.mono ?? "")}">
    </div>
  </fieldset>

  ${GROUPS.map(
    (group) => `<fieldset>
    <legend>${esc(group.heading)}</legend>
    <p class="help">${esc(group.blurb)}</p>
    ${rows(group)}
  </fieldset>`,
  ).join("")}

  <div class="actions"><button type="submit">Save</button></div>
</form>

<form method="post" action="/admin/settings/tokens" id="token-ops" class="new-type">
  <h2>Add to the theme</h2>
  <div class="field">
    <label for="a-group">To</label>
    <select id="a-group" name="group">
      ${GROUPS.map((g) => `<option value="${g.group}">${esc(g.heading)}</option>`).join("")}
    </select>
  </div>
  <div class="field">
    <label for="a-name">Called</label>
    <input id="a-name" name="name" pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*" aria-describedby="a-name-help">
    <p class="help" id="a-name-help">Lowercase words joined by hyphens — <code>accent</code>.
      Blocks name it, so it reads better short.</p>
  </div>
  <div class="field">
    <label for="a-value">Value</label>
    <input id="a-value" name="value" placeholder="#1a7f5a" aria-describedby="a-value-help">
    <p class="help" id="a-value-help">A colour like <code>#1a7f5a</code>, or a size like
      <code>1.25rem</code>.</p>
  </div>
  <button name="op" value="add" type="submit">Add it</button>
</form>`;
}
