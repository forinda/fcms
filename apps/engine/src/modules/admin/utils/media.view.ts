/**
 * The library, as a grid of what is actually there.
 *
 * Thumbnails rather than filenames: nobody recognises `IMG_4821.jpg`, and the
 * whole job of this screen is "which one was it".
 */
import type { AssetRow } from "@forinda-cms/db";

import { esc } from "./view";

export interface MediaOptions {
  readonly assets: readonly AssetRow[];
  readonly error?: string | undefined;
}

export function media(options: MediaOptions): string {
  const { assets, error } = options;

  const items = assets
    .map(
      (asset) => `<figure class="asset">
  ${
    asset.contentType.startsWith("image/")
      ? `<img src="/media/${esc(asset.id)}" alt="${esc(asset.alt ?? "")}" loading="lazy">`
      : `<span class="file">${esc(asset.contentType.split("/")[1] ?? "file")}</span>`
  }
  <figcaption>
    <code>asset:${esc(asset.id)}</code>
    <span class="muted">${esc(asset.filename)} · ${size(asset.bytes)}</span>

    <form method="post" action="/admin/media/${esc(asset.id)}/alt" class="alt">
      <label for="alt-${esc(asset.id)}">Describe it</label>
      <input id="alt-${esc(asset.id)}" name="alt" value="${esc(asset.alt ?? "")}"
             placeholder="What is in the picture?">
      <button class="link" type="submit">Save</button>
    </form>

    <form method="post" action="/admin/media/${esc(asset.id)}/delete">
      <button class="link destructive" type="submit">Delete</button>
    </form>
  </figcaption>
</figure>`,
    )
    .join("\n");

  return `<h1>Media</h1>
${error ? `<p class="error">${esc(error)}</p>` : ""}

<form method="post" action="/admin/media" enctype="multipart/form-data" class="upload">
  <label for="file">Add a picture or a PDF</label>
  <div class="row">
    <input id="file" name="file" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif,application/pdf" required>
    <button type="submit">Upload</button>
  </div>
  <p class="help">Up to 10 MB. JPEG, PNG, WebP, AVIF, GIF or PDF.</p>
</form>

${
  assets.length === 0
    ? '<p class="muted">Nothing here yet.</p>'
    : `<div class="assets">${items}</div>`
}

<p class="help">Use a picture on a page by putting its <code>asset:…</code> reference in an
image block — or pick it from the canvas.</p>`;
}

/** Bytes as a person reads them. */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
