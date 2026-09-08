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
  /**
   * Which top-level place this page belongs to, so the header can mark it.
   *
   * `aria-current` rather than a colour: "where am I" is a question a screen
   * reader has to be able to answer too, and a highlighted link answers it for
   * exactly one kind of user.
   */
  readonly section?: string;
}

const SECTIONS: readonly { key: string; href: string; label: string }[] = [
  { key: "pages", href: "/admin/pages", label: "Pages" },
  { key: "types", href: "/admin/types", label: "Types" },
  { key: "integrations", href: "/admin/integrations", label: "Integrations" },
  { key: "media", href: "/admin/media", label: "Media" },
  { key: "assist", href: "/admin/assist", label: "Assistant" },
  { key: "automations", href: "/admin/automations", label: "Automations" },
  { key: "sessions", href: "/admin/sessions", label: "Sessions" },
  { key: "settings", href: "/admin/settings", label: "Settings" },
];

export function page({ title, body, trail = [], chrome = true, section }: PageOptions): string {
  const crumbs = trail
    .map((c) =>
      c.href ? `<a href="${esc(c.href)}">${esc(c.label)}</a>` : `<span>${esc(c.label)}</span>`,
    )
    .join(`<span class="sep">/</span>`);

  const header = chrome
    ? `<a class="skip" href="#main">Skip to the page</a>
<header>
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/admin">Admin</a>${
    crumbs ? `<span class="sep">/</span>${crumbs}` : ""
  }</nav>
  <nav class="header-actions" aria-label="Sections">
    ${SECTIONS.map(
      (s) =>
        `<a href="${s.href}"${s.key === section ? ' aria-current="page"' : ""}>${esc(s.label)}</a>`,
    ).join("")}
    <form method="post" action="/admin/logout"><button class="link" type="submit">Sign out</button></form>
  </nav>
</header>`
    : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body>
${header}
<main id="main" tabindex="-1">${body}</main>
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
:root{color-scheme:light dark;--ink:#1c1917;--line:#e7e5e4;--muted:#78716c;--brand:#1a7f5a;--bad:#991b1b}
*{box-sizing:border-box}
body{font:16px/1.6 system-ui,sans-serif;margin:0;color:#1c1917;background:#fafaf9}
header{display:flex;justify-content:space-between;align-items:center;gap:1rem;
  padding:.75rem 1rem;border-bottom:1px solid var(--line);background:#fff;flex-wrap:wrap}
main{max-width:52rem;margin:0 auto;padding:1.5rem 1rem 4rem}
/* The canvas needs the width; every other screen reads better narrow. */
main:has(.canvas),main:has(.builder){max-width:82rem}
main:focus{outline:none}
/* Every interactive thing says where the keyboard is. A custom background on a
   button hides the browser's default ring against it more often than not. */
:focus-visible{outline:2px solid var(--brand);outline-offset:2px;border-radius:4px}
/* Present to a screen reader, absent to everyone else — a table caption, or the
   words behind a button whose label is an arrow. */
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
  clip-path:inset(50%);white-space:nowrap;border:0}
.skip{position:absolute;left:-9999px;top:0;padding:.6rem 1rem;background:#fff;z-index:2}
.skip:focus{left:0}
[aria-current=page]{font-weight:600;text-decoration:underline 2px}
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
/* On a phone a wide table scrolls inside its own box. Without this the history
   table — five columns of it — drags the whole page sideways. */
@media(max-width:40rem){table{display:block;overflow-x:auto}}
/* The top of the dashboard. A count first in each line, because the number is
   what decides whether it is opened now or later. */
.attention{margin:1.5rem 0 0}
.attention h2{margin-top:0}
ul.waiting{list-style:none;margin:0;padding:0}
ul.waiting li{padding:.4rem 0;border-bottom:1px solid var(--line)}
ul.waiting li:last-child{border-bottom:0}
ul.waiting a{text-decoration:none}
ul.waiting a:hover{text-decoration:underline}
ul.waiting strong{font-size:1.1rem}
ul.waiting li.destructive-change a{color:var(--bad)}
/* Two panels of recent activity, one column on a narrow screen. */
.two-up{display:grid;grid-template-columns:repeat(auto-fit,minmax(20rem,1fr));gap:0 2rem}
.two-up table{font-size:.9rem}
/* The half of a row that is metadata keeps to one line: "16 minutes ago" broken
   over three lines is taller than the change it is dating. */
.two-up td:not(:first-child){white-space:nowrap;text-align:right}
h3.quiet{font-size:.8rem;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);
  margin:1.5rem 0 .25rem}
.card-actions{margin:.5rem 0 0;font-size:.85rem}
.cards{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));margin-top:.5rem}
.card{padding:1rem;border:1px solid var(--line);border-radius:8px;background:#fff}
.card h3{margin:0 0 .25rem;font-size:1rem}
/* Wraps. Six links and a sign-out button do not fit a phone in one row, and
   without this the last of them sits past the right edge — off the screen, and
   dragging the whole page sideways with it. */
.header-actions{display:flex;gap:.5rem .9rem;align-items:center;flex-wrap:wrap}
@media(max-width:34rem){
  header{padding:.6rem .75rem}
  .header-actions{font-size:.9rem;gap:.4rem .7rem}
}
tr.current td{background:#f5f5f4}
@media(prefers-color-scheme:dark){tr.current td{background:#292524}}
ul.changes{margin:.5rem 0 0;padding-left:1.1rem}
ul.changes li{margin:.35rem 0}
li.destructive-change{color:var(--bad)}
.warn{color:var(--muted);font-size:.9rem}
textarea{width:100%;padding:.55rem;font:inherit;border:1px solid #d6d3d1;border-radius:6px}
.field{margin:1.1rem 0}
label{display:block;margin-bottom:.3rem;font-size:.875rem;font-weight:500}
input,select,textarea{width:100%;padding:.55rem;font:inherit;border:1px solid #d6d3d1;border-radius:6px;background:#fff}
input[type=checkbox]{width:auto}
textarea.mono{font-family:ui-monospace,monospace;font-size:.85rem}
.has-error input,.has-error select,.has-error textarea{border-color:var(--bad)}
.field-error{color:var(--bad);font-size:.85rem;margin:.35rem 0 0}
.error{padding:.6rem .8rem;border-radius:6px;background:#fee2e2;color:var(--bad);font-size:.9rem}
.error p{margin:0 0 .5rem}
.error p:last-child{margin:0}
/* A refusal that offers the way through keeps the offer inside it, so the
   button and the sentence explaining the cost are one thing. */
.error form{margin:.5rem 0 0}
.error button{background:#fff}
.actions{margin-top:1.5rem}
button{padding:.55rem 1rem;font:inherit;border:0;border-radius:6px;background:var(--brand);color:#fff;cursor:pointer}
button.link{background:none;color:var(--brand);padding:0;text-decoration:underline}
button.destructive{background:#fff;color:var(--bad);border:1px solid var(--bad)}
.danger{margin-top:2.5rem;padding-top:1.5rem;border-top:1px solid var(--line)}
.pill{display:inline-block;padding:.1rem .45rem;border-radius:99px;font-size:.75rem;background:#f5f5f4;color:var(--muted)}
.pill.destructive{background:#fee2e2;color:var(--bad)}
.pill.live{background:#dcfce7;color:#166534}
form.inline{display:inline}
.upload{margin:1rem 0 1.5rem;padding:1rem;border:1px dashed var(--line);border-radius:8px}
.upload .row{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.assets{display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))}
.asset{margin:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--card,#fff)}
.asset img{width:100%;height:9rem;object-fit:cover;display:block;background:#f5f5f4}
.asset .file{display:flex;align-items:center;justify-content:center;height:9rem;
  background:#f5f5f4;color:var(--muted);text-transform:uppercase;font-size:.8rem;letter-spacing:.08em}
.asset figcaption{padding:.6rem;display:grid;gap:.35rem;font-size:.8rem}
.asset code{font-size:.7rem;word-break:break-all;color:var(--muted)}
.asset .alt{display:grid;gap:.25rem}

/* The canvas (ADR 0017): tree, the real page, inspector. One column on a phone,
   where doc 14 says half this audience is. */
.canvas{display:grid;grid-template-columns:minmax(13rem,17rem) minmax(0,1fr) minmax(13rem,18rem);
  gap:1rem;align-items:start;margin-top:1rem}
@media(max-width:70rem){.canvas{grid-template-columns:1fr}}
.canvas .preview{border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#fff}
.canvas iframe{width:100%;height:34rem;border:0;display:block}
.canvas .tree h2{margin:0;font-size:1rem}
ul.blocks,ul.blocks ul{list-style:none;margin:.4rem 0 0;padding:0 0 0 .7rem}
ul.blocks ul{border-left:1px solid var(--line)}
.node{display:flex;align-items:center;gap:.3rem;padding:.15rem .25rem;border-radius:6px;min-width:0}
.node.selected{background:#ecfdf5;outline:1px solid var(--brand)}
.node>a{flex:1;min-width:0;text-decoration:none;color:inherit;font-size:.85rem;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.node-actions{display:flex;gap:0;opacity:.3;flex:none}
.node:hover .node-actions,.node.selected .node-actions{opacity:1}
.node-actions button{background:none;color:var(--muted);border:0;padding:.05rem .2rem;
  font-size:.75rem;line-height:1.2;cursor:pointer;border-radius:4px}
.node-actions button:hover{background:var(--line);color:var(--ink)}
.node-actions button.destructive{background:none;border:0;color:var(--bad)}
.canvas .add{margin-top:1.1rem;border-top:1px solid var(--line);padding-top:.9rem}
.canvas .add .row{display:flex;gap:.4rem}
.canvas .add select,.canvas .add input{flex:1;min-width:0}
textarea.code{width:100%;font:.85rem/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
  padding:.5rem;border:1px solid var(--line);border-radius:6px;background:inherit;color:inherit}
/* The type builder (ADR 0033): the fields on the left, the one being edited on
   the right. Two columns rather than the canvas's three — there is nothing to
   preview, so the middle column would be empty. */
.builder{display:grid;grid-template-columns:minmax(15rem,22rem) minmax(0,1fr);gap:1.5rem;
  align-items:start;margin:1rem 0 2rem}
@media(max-width:60rem){.builder{grid-template-columns:1fr}}
.builder .tree h2,.builder .panel h2{margin-top:0}
/* Numbered, because the order is the thing being edited: "move Price up" is
   about position, and a bullet does not say what position. */
ol.blocks{list-style:decimal;margin:.5rem 0 0;padding-left:1.7rem}
ol.blocks li{margin:.1rem 0}
.builder .add{margin-top:1.5rem;border-top:1px solid var(--line);padding-top:1rem}
.builder .add h3{font-size:.9rem;margin:0}
.builder .node>a{padding:.15rem 0}
/* A label beside its box, not above it: a checkbox's label is the sentence it
   completes, and a column of them reads as a list. */
.field.checkbox{display:grid;grid-template-columns:auto 1fr;gap:.1rem .5rem;align-items:center}
.field.checkbox label{margin:0;font-weight:400}
.field.checkbox .help{grid-column:2}
/* The theme, as rows: name, the value itself, what would break, remove. */
ul.tokens{list-style:none;margin:.5rem 0 0;padding:0;display:grid;gap:.35rem}
ul.tokens li{display:grid;grid-template-columns:8rem auto 1fr auto;gap:.6rem;align-items:center}
ul.tokens li:has(input[type=color]){grid-template-columns:8rem auto 5rem 1fr auto}
ul.tokens code{font-size:.8rem}
ul.tokens label{margin:0}
ul.tokens input{width:auto;min-width:8rem}
ul.tokens input[type=color]{width:3rem;height:2rem;padding:.15rem;min-width:0}
ul.tokens .muted{font-size:.8rem}
ul.tokens button{background:none;border:0;color:var(--bad);padding:.1rem .35rem;border-radius:4px}
ul.tokens button[disabled]{color:var(--muted);cursor:not-allowed}
@media(max-width:40rem){
  ul.tokens li,ul.tokens li:has(input[type=color]){grid-template-columns:1fr auto;
    gap:.2rem .5rem;padding-bottom:.5rem;border-bottom:1px solid var(--line)}
}
fieldset{border:1px solid var(--line);border-radius:8px;padding:.75rem 1rem 1rem;margin:1.5rem 0}
legend{padding:0 .35rem;font-size:.8rem;text-transform:uppercase;letter-spacing:.07em;
  color:var(--muted)}
/* The first screen: one card per starting point, each its own form. */
.cards.starters{grid-template-columns:repeat(auto-fit,minmax(17rem,1fr));margin-top:1.5rem}
.card.starter{display:flex;flex-direction:column;gap:.5rem}
.card.starter ul{margin:0;padding-left:1.1rem;font-size:.85rem;color:var(--muted)}
.card.starter button{margin-top:auto;align-self:flex-start}
.lede{font-size:1.05rem;max-width:42rem}
.new-type{margin:2.5rem 0 0;padding-top:1.5rem;border-top:1px solid var(--line)}
.new-automation{margin:1.5rem 0;padding-top:1rem;border-top:1px solid var(--line)}
.new-automation .row{display:flex;gap:.4rem;flex-wrap:wrap}
.new-automation input{flex:1;min-width:10rem}
.stage .run{border:1px solid var(--line);border-radius:8px;padding:.6rem .8rem;margin-bottom:.6rem}
.stage .run.destructive{border-color:var(--bad)}
.stage .run ol{margin:.3rem 0 0;padding-left:1.1rem;font-size:.85rem;color:var(--muted)}
.canvas .components{margin-top:1.1rem;border-top:1px solid var(--line);padding-top:.9rem}
.canvas .components h3{margin:0 0 .3rem;font-size:.72rem;text-transform:uppercase;
  letter-spacing:.07em;color:var(--muted)}
.canvas .components ul{list-style:none;margin:0;padding:0;font-size:.85rem}
.canvas .components li{padding:.1rem 0}
/* A pill sits beside a node's label, never over it: the label truncates, the
   pill keeps its size, and neither wins the row. */
.node .pill{flex:none;font-size:.65rem;padding:.05rem .35rem;white-space:nowrap}
a.pill{text-decoration:none}
.inspector h3{margin:0 0 .1rem;font-size:.95rem}
.inspector .field{margin:.6rem 0}
.inspector .group{margin:0 0 1.1rem;padding:0 0 .6rem;border-bottom:1px solid var(--line)}
.inspector .group:last-of-type{border-bottom:0}
.inspector h4{margin:.9rem 0 .2rem;font-size:.72rem;text-transform:uppercase;
  letter-spacing:.07em;color:var(--muted)}
.inspector.saving{opacity:.6}
.inspector .actions{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
.inspector .saved{margin:0}
.inspector label{font-size:.78rem;color:var(--muted);margin-bottom:.15rem}
.node.drop{outline:2px solid var(--brand)}
.node[draggable=true]{cursor:grab}
.viewport-bar{display:flex;justify-content:space-between;align-items:center;gap:.5rem;
  margin-bottom:.5rem;font-size:.85rem;flex-wrap:wrap}
.stage-actions{display:flex;align-items:center;gap:.6rem}
button.publish{padding:.25rem .7rem;font-size:.8rem}
.sizes{display:flex;gap:.2rem}
button.size{background:none;color:var(--muted);border:1px solid var(--line);padding:.2rem .6rem;
  font-size:.8rem;border-radius:6px}
button.size.on{background:var(--brand);color:#fff;border-color:var(--brand)}
.stage .preview{transition:max-width .15s ease}
@media(prefers-color-scheme:dark){
  :root{--ink:#e7e5e4}
  body{background:#1c1917;color:#e7e5e4}
  .node.selected{background:#064e3b}
  .canvas .preview{background:#fff}
  header,.card,input,select,textarea{background:#292524;border-color:#44403c}
  :root{--line:#44403c;--muted:#a8a29e}
}
`.trim();
