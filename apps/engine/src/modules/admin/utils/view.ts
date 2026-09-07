/**
 * The admin's HTML.
 *
 * Server-rendered with no build step and no framework. ADR 0002 scopes the admin
 * to "forms over spec, no canvas", and a React app for a form is a build
 * pipeline, a bundle and a hydration story for something HTML already does —
 * it also has to work on the small box and the phone doc 14 targets.
 *
 * Everything is escaped. The admin renders content written by site visitors
 * (a booking's customer name), so an unescaped listing is stored XSS aimed at
 * the one person who can change everything.
 */
import type { ContentType, Field } from "@forinda-cms/spec";
import { inputTypeFor } from "@forinda-cms/render";

export function esc(value: unknown): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return String(value ?? "").replace(/[&<>"']/g, (c) => map[c]!);
}

export interface PageOptions {
  readonly title: string;
  readonly body: string;
  /** Shown as a breadcrumb trail; the last entry is the current page. */
  readonly trail?: { label: string; href?: string }[];
  /**
   * Off for the login screen, which has nobody to sign out and nowhere to
   * navigate — the header's crumbs and its sign-out button are both addressed
   * to someone who already has a session.
   */
  readonly chrome?: boolean;
}

export function page({ title, body, trail = [], chrome = true }: PageOptions): string {
  const crumbs = trail
    .map((c) =>
      c.href ? `<a href="${esc(c.href)}">${esc(c.label)}</a>` : `<span>${esc(c.label)}</span>`,
    )
    .join(`<span class="sep">/</span>`);

  const header = chrome
    ? `<header>
  <nav class="crumbs"><a href="/admin">Admin</a>${crumbs ? `<span class="sep">/</span>${crumbs}` : ""}</nav>
  <form method="post" action="/admin/logout"><button class="link" type="submit">Sign out</button></form>
</header>`
    : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body>
${header}
<main>${body}</main>
</body></html>`;
}

/**
 * One input, generated from a field's declaration.
 *
 * The type mapping is imported rather than repeated — the `form` block generates
 * the same inputs from the same declarations, and two copies would drift into a
 * form that accepts what the schema rejects.
 */
export function fieldInput(field: Field, value: unknown, error?: string): string {
  const id = `f-${field.name}`;
  const required = "required" in field && field.required === true;
  const label = `<label for="${id}">${esc(field.label)}${required ? ' <span class="req">required</span>' : ""}</label>`;
  const help = "help" in field && field.help ? `<p class="help">${esc(field.help)}</p>` : "";
  const err = error ? `<p class="field-error">${esc(error)}</p>` : "";

  const control = ((): string => {
    switch (field.type) {
      case "richtext":
        return `<textarea id="${id}" name="${esc(field.name)}" rows="8"${required ? " required" : ""}>${esc(value)}</textarea>`;
      case "boolean":
        return `<input id="${id}" name="${esc(field.name)}" type="checkbox"${value ? " checked" : ""}>`;
      case "select": {
        const options = "options" in field ? field.options : [];
        const chosen = String(value ?? "");
        return `<select id="${id}" name="${esc(field.name)}"${required ? " required" : ""}>
          <option value=""${chosen ? "" : " selected"}>—</option>
          ${options.map((o) => `<option value="${esc(o.value)}"${o.value === chosen ? " selected" : ""}>${esc(o.label)}</option>`).join("")}
        </select>`;
      }
      case "state": {
        // Every declared state is offered. The platform refuses an illegal
        // transition (ADR 0009 §4), so the form does not need to know the graph.
        const values = "values" in field ? field.values : [];
        const chosen = String(value ?? "");
        return `<select id="${id}" name="${esc(field.name)}">
          ${values.map((v) => `<option value="${esc(v)}"${v === chosen ? " selected" : ""}>${esc(v)}</option>`).join("")}
        </select>`;
      }
      case "hours":
        // Structured, but a grid editor is canvas work. JSON here is honest
        // about being a stopgap rather than pretending to be an editor.
        return `<textarea id="${id}" name="${esc(field.name)}" rows="6" class="mono">${esc(
          value === undefined ? "" : JSON.stringify(value, null, 2),
        )}</textarea>`;
      default:
        return `<input id="${id}" name="${esc(field.name)}" type="${inputTypeFor(field.type)}" value="${esc(value)}"${required ? " required" : ""}>`;
    }
  })();

  return `<div class="field${error ? " has-error" : ""}">${label}${control}${err}${help}</div>`;
}

/** The sign-in form, on the same chrome as every other admin page. */
export function loginForm(error?: string): string {
  return (
    (error ? `<p class="error">${esc(error)}</p>` : "") +
    `<h1>Sign in</h1>
<form method="post" action="/admin/login">
  <div class="field">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="username" required autofocus>
  </div>
  <div class="field">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
  </div>
  <div class="actions"><button type="submit">Sign in</button></div>
</form>`
  );
}

/** A form for one entry, generated entirely from the type's declarations. */
export function entryForm(
  type: ContentType,
  data: Record<string, unknown>,
  options: {
    action: string;
    slug?: string | null;
    errors?: Record<string, string>;
    deleteAction?: string;
  },
): string {
  const errors = options.errors ?? {};
  const general = errors["_"] ? `<p class="error">${esc(errors["_"])}</p>` : "";

  // A type usually declares `slug` itself — the salon's does — and rendering
  // the address control unconditionally put two "Slug" inputs on the form, with
  // the same `id`, disagreeing about which one the address comes from. So the
  // declared field is the control when there is one, and `__slug` appears only
  // for a type that declares none.
  const declaresSlug = type.fields.some((f) => f.name === "slug");
  const addressField = declaresSlug
    ? ""
    : `<div class="field">
    <label for="f-__slug">Slug</label>
    <input id="f-__slug" name="__slug" value="${esc(options.slug ?? "")}">
    <p class="help">Used in the page address. Leave blank if this type has no page of its own.</p>
  </div>`;

  return `${general}
<form method="post" action="${esc(options.action)}">
  ${addressField}
  ${type.fields
    .map((f) =>
      fieldInput(
        f,
        f.name === "slug" ? (data[f.name] ?? options.slug) : data[f.name],
        errors[f.name],
      ),
    )
    .join("\n")}
  <div class="actions">
    <button type="submit">Save</button>
  </div>
</form>
${
  options.deleteAction
    ? `<form method="post" action="${esc(options.deleteAction)}" class="danger">
  <button type="submit" class="destructive">Delete this entry</button>
  <p class="help">This cannot be undone from here.</p>
</form>`
    : ""
}`;
}

const CSS = `
:root{color-scheme:light dark;--line:#e7e5e4;--muted:#78716c;--brand:#1a7f5a;--bad:#991b1b}
*{box-sizing:border-box}
body{font:16px/1.6 system-ui,sans-serif;margin:0;color:#1c1917;background:#fafaf9}
header{display:flex;justify-content:space-between;align-items:center;gap:1rem;
  padding:.75rem 1rem;border-bottom:1px solid var(--line);background:#fff;flex-wrap:wrap}
main{max-width:52rem;margin:0 auto;padding:1.5rem 1rem 4rem}
a{color:var(--brand)}
h1{font-size:1.4rem;margin:0 0 .25rem}
h2{font-size:1.05rem;margin:2rem 0 .5rem}
.crumbs{display:flex;gap:.4rem;align-items:center;flex-wrap:wrap}
.sep{color:var(--muted)}
.muted,.help{color:var(--muted);font-size:.85rem}
.help{margin:.35rem 0 0}
.req{color:var(--muted);font-weight:400;font-size:.75rem}
table{width:100%;border-collapse:collapse;margin:.5rem 0 0}
th,td{text-align:left;padding:.55rem .5rem;border-bottom:1px solid var(--line)}
th{font-size:.8rem;color:var(--muted);font-weight:600}
.cards{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));margin-top:.5rem}
.card{padding:1rem;border:1px solid var(--line);border-radius:8px;background:#fff}
.card h3{margin:0 0 .25rem;font-size:1rem}
.field{margin:1.1rem 0}
label{display:block;margin-bottom:.3rem;font-size:.875rem;font-weight:500}
input,select,textarea{width:100%;padding:.55rem;font:inherit;border:1px solid #d6d3d1;border-radius:6px;background:#fff}
input[type=checkbox]{width:auto}
textarea.mono{font-family:ui-monospace,monospace;font-size:.85rem}
.has-error input,.has-error select,.has-error textarea{border-color:var(--bad)}
.field-error{color:var(--bad);font-size:.85rem;margin:.35rem 0 0}
.error{padding:.6rem .8rem;border-radius:6px;background:#fee2e2;color:var(--bad);font-size:.9rem}
.actions{margin-top:1.5rem}
button{padding:.55rem 1rem;font:inherit;border:0;border-radius:6px;background:var(--brand);color:#fff;cursor:pointer}
button.link{background:none;color:var(--brand);padding:0;text-decoration:underline}
button.destructive{background:#fff;color:var(--bad);border:1px solid var(--bad)}
.danger{margin-top:2.5rem;padding-top:1.5rem;border-top:1px solid var(--line)}
.pill{display:inline-block;padding:.1rem .45rem;border-radius:99px;font-size:.75rem;background:#f5f5f4;color:var(--muted)}
.pill.destructive{background:#fee2e2;color:var(--bad)}
@media(prefers-color-scheme:dark){
  body{background:#1c1917;color:#e7e5e4}
  .node.selected{background:#064e3b}
  header,.card,input,select,textarea{background:#292524;border-color:#44403c}
  :root{--line:#44403c;--muted:#a8a29e}
}
`.trim();
