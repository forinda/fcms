/**
 * Integrations (ADR 0034).
 *
 * No per-vendor form here. Every control is generated from what the kind
 * declares, which is what the provider reads — so a vendor gaining a setting
 * gains a control, and a screen cannot ask for something nothing reads.
 *
 * A secret's control takes the **name of an environment variable**. The value
 * is never rendered, never posted and never stored; what this screen can say
 * about it is whether the machine currently has one, which is the question an
 * owner is actually asking when a payment will not start.
 */
import type { Integration, SiteSpec } from "@forinda-cms/spec";

import type { IntegrationKindInfo, Setting } from "@/shared/integrations";
import { esc } from "./view";

export interface IntegrationListOptions {
  readonly spec: SiteSpec;
  readonly kinds: Record<string, IntegrationKindInfo>;
  readonly error?: string | undefined;
}

export function integrationList({ spec, kinds, error }: IntegrationListOptions): string {
  const row = (i: Integration) => {
    const info = kinds[i.kind];
    return `<tr>
  <td><a href="/admin/integrations/${esc(i.key)}">${esc(i.label ?? i.key)}</a>${
    i.enabled === false ? ' <span class="pill">off</span>' : ""
  }</td>
  <td class="muted">${esc(info?.label ?? i.kind)}${
    info?.unverified ? ' <span class="pill">unverified</span>' : ""
  }</td>
  <td class="muted"><code>${esc(i.key)}</code></td>
</tr>`;
  };

  const offered = Object.values(kinds).filter((k) => !k.unimplemented);
  const missing = Object.values(kinds).filter((k) => k.unimplemented);

  return `${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
<h1>Integrations</h1>
<p class="muted">Everything outside this site that it talks to. Declared here once and
named by automations and payments, so the list of places your data can go is a list you
can read.</p>

${
  spec.wiring.length === 0
    ? `<p class="muted">Nothing is declared yet.</p>`
    : `<table>
  <caption class="sr-only">Integrations this site declares</caption>
  <thead><tr><th scope="col">Name</th><th scope="col">Kind</th><th scope="col">Key</th></tr></thead>
  <tbody>${spec.wiring.map(row).join("")}</tbody>
</table>`
}

<form method="post" action="/admin/integrations" class="new-type">
  <h2>Declare one</h2>
  <div class="field">
    <label for="i-kind">Kind</label>
    <select id="i-kind" name="kind">
      ${offered
        .map((k) => `<option value="${esc(k.kind)}">${esc(k.label)} — ${esc(k.summary)}</option>`)
        .join("")}
    </select>
  </div>
  <div class="field">
    <label for="i-key">Key</label>
    <input id="i-key" name="key" required pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*"
      aria-describedby="i-key-help">
    <p class="help" id="i-key-help">Lowercase words joined by hyphens — <code>team-chat</code>.
      Automations name it by this, and it cannot be changed later.</p>
  </div>
  <div class="field">
    <label for="i-label">Name</label>
    <input id="i-label" name="label" aria-describedby="i-label-help">
    <p class="help" id="i-label-help">Optional — what you call it.</p>
  </div>
  <div class="actions"><button type="submit">Declare it</button></div>
</form>

${
  missing.length > 0
    ? `<h3 class="quiet">Not yet</h3>
<p class="muted">${missing
        .map((k) => esc(k.label))
        .join(", ")} — the spec allows these kinds and nothing implements them, so they are
  not offered rather than being a form that does nothing.</p>`
    : ""
}`;
}

export interface IntegrationEditOptions {
  readonly integration: Integration;
  readonly info: IntegrationKindInfo;
  readonly config: readonly Setting[];
  readonly secrets: readonly Setting[];
  /** Which named environment variables the machine currently has a value for. */
  readonly present: Readonly<Record<string, boolean>>;
  readonly usedBy: readonly string[];
  /** Required settings with nothing in them yet, in the words the form used. */
  readonly missing: readonly string[];
  readonly error?: string | undefined;
}

export function integrationEdit(options: IntegrationEditOptions): string {
  const { integration, info, config, secrets, present, usedBy, missing, error } = options;
  const stored = integration.config ?? {};

  return `${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
<h1>${esc(integration.label ?? integration.key)}</h1>
<p class="muted">${esc(info.label)} <span class="sep">·</span>
  <code>${esc(integration.key)}</code></p>
<p class="help">${esc(info.summary)}</p>
${
  info.unverified
    ? `<p class="warn">This one is written against the vendor's documented API and has never
       run against a real account. Try it before you rely on it.</p>`
    : ""
}
${
  missing.length > 0
    ? `<p class="error" role="status">Not finished: it still needs
       ${missing.map((m) => esc(m)).join(" and ")}. Nothing that names it will work until
       ${missing.length === 1 ? "that is" : "those are"} filled in.</p>`
    : ""
}

<form method="post" action="/admin/integrations/${esc(integration.key)}">
  <div class="field">
    <label for="s-label">Name</label>
    <input id="s-label" name="label" value="${esc(integration.label ?? "")}">
  </div>
  <div class="field checkbox">
    <input type="hidden" name="enabled" value="off">
    <input id="s-enabled" name="enabled" type="checkbox" value="on"${
      integration.enabled === false ? "" : " checked"
    }>
    <label for="s-enabled">In use</label>
    <p class="help">Turn it off to stop everything that names it, without deleting it.</p>
  </div>

  ${
    config.length > 0
      ? `<fieldset>
    <legend>Settings</legend>
    ${config.map((s) => control(`config__${s.name}`, s, stored[s.name])).join("")}
  </fieldset>`
      : ""
  }

  ${
    secrets.length > 0
      ? `<fieldset>
    <legend>Credentials</legend>
    <p class="help">Each of these is the <strong>name of an environment variable</strong> —
      never the value. The secret stays on the machine; the site's spec only says where to
      look, so it stays safe to print, commit and hand to anyone.</p>
    ${secrets
      .map((s) => {
        const ref = integration.secrets?.[s.name] ?? "";
        const name = ref.replace(/^secret:/, "");
        const status = name
          ? present[name]
            ? `<span class="pill live">this machine has it</span>`
            : `<span class="pill destructive">this machine has no ${esc(name)}</span>`
          : "";
        return `<div class="field">
      <label for="f-secret-${esc(s.name)}">${esc(s.label)}${
        s.required ? ' <span class="req">required</span>' : ""
      }</label>
      <input id="f-secret-${esc(s.name)}" name="secret__${esc(s.name)}" value="${esc(name)}"
        placeholder="MPESA_PASSKEY" aria-describedby="h-secret-${esc(s.name)}">
      <p class="help" id="h-secret-${esc(s.name)}">${esc(s.help ?? "")} ${status}</p>
    </div>`;
      })
      .join("")}
  </fieldset>`
      : ""
  }

  <div class="actions"><button type="submit">Save</button></div>
</form>

<form method="post" action="/admin/integrations/${esc(integration.key)}/delete" class="danger">
  <h2>Remove it</h2>
  ${
    usedBy.length > 0
      ? `<p class="help">Not while ${usedBy.map((u) => esc(u)).join(" and ")}.</p>`
      : `<p class="help">Nothing names it, so nothing breaks.</p>`
  }
  <button type="submit" class="destructive"${usedBy.length > 0 ? " disabled" : ""}>Remove
    ${esc(integration.label ?? integration.key)}</button>
</form>`;
}

/** One control, from one declared setting. */
function control(name: string, setting: Setting, value: unknown): string {
  const id = `f-${name}`;
  // A choice with nothing stored shows its declared default, because that is
  // what a save would write. A select that displays its first option while
  // holding nothing is a control lying about the state it represents.
  const current =
    value === undefined || value === null
      ? setting.default === undefined
        ? ""
        : String(setting.default)
      : String(value);
  const label = `<label for="${id}">${esc(setting.label)}${
    setting.required ? ' <span class="req">required</span>' : ""
  }</label>`;
  const help = setting.help ? `<p class="help" id="h-${name}">${esc(setting.help)}</p>` : "";
  const described = setting.help ? ` aria-describedby="h-${name}"` : "";

  if (setting.kind === "boolean") {
    return `<div class="field checkbox">
  <input type="hidden" name="${name}" value="off">
  <input id="${id}" name="${name}" type="checkbox" value="on"${value === true ? " checked" : ""}${described}>
  ${label}
  ${help}
</div>`;
  }

  if (setting.kind === "choice") {
    return `<div class="field">
  ${label}
  <select id="${id}" name="${name}"${described}>
    ${(setting.options ?? [])
      .map(
        (o) =>
          `<option value="${esc(o.value)}"${o.value === current ? " selected" : ""}>${esc(o.label)}</option>`,
      )
      .join("")}
  </select>
  ${help}
</div>`;
  }

  return `<div class="field">
  ${label}
  <input id="${id}" name="${name}" type="${setting.kind === "number" ? "number" : "text"}"
    value="${esc(current)}"${described}>
  ${help}
</div>`;
}
