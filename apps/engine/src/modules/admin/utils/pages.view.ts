/**
 * The pages of the site, and what one is (ADR 0035).
 *
 * The canvas edits what is on a page. This is the page itself: its address, its
 * title, whether the public can see it yet — and the two buttons that had no
 * screen at all, "add" and "remove".
 */
import type { Page, SiteSpec } from "@forinda-cms/spec";
import { collectionType } from "@forinda-cms/spec";

import { esc } from "./view";

export interface PageListOptions {
  readonly spec: SiteSpec;
  readonly error?: string | undefined;
}

export function pageList({ spec, error }: PageListOptions): string {
  const row = (p: Page) => `<tr>
  <td><a href="/admin/pages/${esc(p.key)}">${esc(p.title)}</a>${
    p.draft ? ' <span class="pill">draft</span>' : ""
  }${
    collectionType(p.collection)
      ? ` <span class="pill">one per ${esc(collectionType(p.collection)!)}</span>`
      : ""
  }</td>
  <td class="muted"><code>${esc(p.path)}</code></td>
  <td class="muted">${p.blocks.length} ${p.blocks.length === 1 ? "section" : "sections"}</td>
  <td><a href="/admin/pages/${esc(p.key)}">Edit</a> <span class="sep">·</span>
      <a href="/admin/pages/${esc(p.key)}/settings">Settings</a> <span class="sep">·</span>
      <a href="/admin/pages/${esc(p.key)}/flows">Journeys${
        p.flows?.length ? ` (${p.flows.length})` : ""
      }</a> <span class="sep">·</span>
      <a href="${esc(p.path)}">View</a></td>
</tr>`;

  return `${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
<h1>Pages</h1>
<p class="muted">Each one is a tree of sections, edited on the canvas — where the page you
are changing is the page you are looking at.</p>

${
  spec.pages.length === 0
    ? `<p class="muted">No pages yet.</p>`
    : `<table>
  <caption class="sr-only">Pages on this site</caption>
  <thead><tr><th scope="col">Page</th><th scope="col">Address</th><th scope="col">Size</th>
    <th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
  <tbody>${spec.pages.map(row).join("")}</tbody>
</table>`
}

<form method="post" action="/admin/pages" class="new-type">
  <h2>Add a page</h2>
  <div class="field">
    <label for="p-title">Title</label>
    <input id="p-title" name="title" required aria-describedby="p-title-help">
    <p class="help" id="p-title-help">What it is called — “About us”.</p>
  </div>
  <div class="field">
    <label for="p-path">Address</label>
    <input id="p-path" name="path" required placeholder="/about" aria-describedby="p-path-help">
    <p class="help" id="p-path-help">Where it answers. <code>/</code> is the front page.</p>
  </div>
  <div class="field">
    <label for="p-key">Key</label>
    <input id="p-key" name="key" required pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*"
      aria-describedby="p-key-help">
    <p class="help" id="p-key-help">Lowercase words joined by hyphens — <code>about</code>.
      Used in the admin's own addresses, and fixed once made.</p>
  </div>
  <div class="actions"><button type="submit">Add it — it starts empty</button></div>
</form>`;
}

export interface PageSettingsOptions {
  readonly spec: SiteSpec;
  readonly page: Page;
  /** Set by a refusal: the second press goes ahead. */
  readonly confirm?: boolean;
  readonly error?: string | undefined;
}

export function pageSettings({ spec, page, confirm, error }: PageSettingsOptions): string {
  const seo = page.seo ?? ({} as NonNullable<Page["seo"]>);
  const bound = collectionType(page.collection);

  const offer = confirm
    ? `<form method="post" action="/admin/pages/${esc(page.key)}/delete">
  <input type="hidden" name="confirm" value="yes">
  <button type="submit" class="destructive">Yes, delete ${esc(page.title)}</button>
</form>`
    : "";

  return `${
    error
      ? `<div class="error" role="alert">${error
          .split("\n")
          .map((line) => line.trim().replace(/^- /, ""))
          .filter(Boolean)
          .map((line) => `<p>${esc(line)}</p>`)
          .join("")}${offer}</div>`
      : ""
  }
<h1>${esc(page.title)}</h1>
<p class="muted"><code>${esc(page.path)}</code> <span class="sep">·</span>
  ${page.blocks.length} ${page.blocks.length === 1 ? "section" : "sections"}
  <span class="sep">·</span> <a href="/admin/pages/${esc(page.key)}">open the canvas</a>
  <span class="sep">·</span> <a href="${esc(page.path)}">view it</a></p>

<form method="post" action="/admin/pages/${esc(page.key)}/settings">
  <div class="field">
    <label for="g-title">Title</label>
    <input id="g-title" name="title" value="${esc(page.title)}" required>
  </div>
  <div class="field">
    <label for="g-path">Address</label>
    <input id="g-path" name="path" value="${esc(page.path)}" required>
  </div>
  <div class="field checkbox">
    <input type="hidden" name="draft" value="off">
    <input id="g-draft" name="draft" type="checkbox" value="on"${page.draft ? " checked" : ""}>
    <label for="g-draft">Still a draft</label>
    <p class="help">A draft is not served to the public. It is still on the canvas.</p>
  </div>
  <div class="field">
    <label for="g-collection">One page per entry of</label>
    <select id="g-collection" name="collection" aria-describedby="g-collection-help">
      <option value=""${bound ? "" : " selected"}>— just this one page</option>
      ${spec.content
        .map(
          (t) =>
            `<option value="${esc(t.key)}"${t.key === bound ? " selected" : ""}>${esc(t.label)}</option>`,
        )
        .join("")}
    </select>
    <p class="help" id="g-collection-help">Turns it into a detail page: every entry answers at
      the address above plus its own slug — <code>${esc(page.path.replace(/\/$/, ""))}/haircut</code>.
      The address on its own stops answering.</p>
  </div>
  <div class="field checkbox">
    <input type="hidden" name="bare" value="off">
    <input id="g-bare" name="bare" type="checkbox" value="on"${
      page.layout === "none" ? " checked" : ""
    }>
    <label for="g-bare">Without the site's header and footer</label>
  </div>

  <fieldset>
    <legend>How it appears in search and when shared</legend>
    <div class="field">
      <label for="g-seo-title">Title</label>
      <input id="g-seo-title" name="seoTitle" value="${esc(seo.title ?? "")}"
        aria-describedby="g-seo-title-help">
      <p class="help" id="g-seo-title-help">Optional. The page's own title is used otherwise.</p>
    </div>
    <div class="field">
      <label for="g-seo-description">Description</label>
      <input id="g-seo-description" name="seoDescription" value="${esc(seo.description ?? "")}">
    </div>
    <div class="field checkbox">
      <input type="hidden" name="noindex" value="off">
      <input id="g-noindex" name="noindex" type="checkbox" value="on"${
        seo.noindex ? " checked" : ""
      }>
      <label for="g-noindex">Ask search engines to skip it</label>
    </div>
  </fieldset>

  <div class="actions"><button type="submit">Save</button></div>
</form>

<form method="post" action="/admin/pages/${esc(page.key)}/delete" class="danger">
  <h2>Delete this page</h2>
  <p class="help">Its ${page.blocks.length}
    ${page.blocks.length === 1 ? "section goes" : "sections go"} with it. You are asked to
    confirm, and history keeps a record either way.</p>
  <button type="submit" class="destructive">Delete ${esc(page.title)}</button>
</form>`;
}
