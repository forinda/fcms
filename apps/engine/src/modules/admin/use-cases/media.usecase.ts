/**
 * Uploading, listing and deleting media.
 *
 * Not a spec change, so it does not go through the patch spine: a photo is
 * data, like an entry. What *is* a spec change is a page referring to one, and
 * that already goes through the normal path.
 */
import { Inject, Scope as Lifetime, Service, getEnv } from "@forinda/kickjs";
import type { AssetRow } from "@forinda-cms/db";

import { AssetRepository } from "@/shared/repositories/asset.repository";
import { BlobStore } from "@/shared/media/blob-store";

/**
 * What may be uploaded.
 *
 * An allowlist, not a blocklist: the set of things a CMS needs to serve is
 * small and known, and "everything except the dangerous ones" is a list nobody
 * finishes. SVG is deliberately absent — it is a script container, and serving
 * one from the site's own origin is stored XSS with a friendly extension.
 */
const ALLOWED = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
  ["image/gif", "gif"],
  ["application/pdf", "pdf"],
]);

/** 10 MB. Large enough for a photo off a phone, small enough to bound a disk. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type UploadResult =
  | { readonly ok: true; readonly asset: AssetRow; readonly deduplicated: boolean }
  | { readonly ok: false; readonly error: string };

@Service({ scope: Lifetime.REQUEST })
export class MediaUseCase {
  private readonly blobs: BlobStore;

  constructor(@Inject(AssetRepository) private readonly assets: AssetRepository) {
    // Beside the database in the install's data directory, so one backup
    // command can cover both once `backup.sh` learns about it.
    this.blobs = new BlobStore(getEnv("MEDIA_DIR") ?? "./data/media");
  }

  list(): Promise<AssetRow[]> {
    return this.assets.list();
  }

  byId(id: string): Promise<AssetRow | null> {
    return this.assets.byId(id);
  }

  read(hash: string): Promise<Buffer> {
    return this.blobs.read(hash);
  }

  async upload(file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
  }): Promise<UploadResult> {
    if (!ALLOWED.has(file.mimetype)) {
      return { ok: false, error: `${file.mimetype} cannot be uploaded here.` };
    }
    if (file.buffer.byteLength > MAX_UPLOAD_BYTES) {
      return { ok: false, error: "That file is larger than 10 MB." };
    }

    // The declared type is a claim by the browser. The magic bytes are the
    // file — and an HTML document uploaded as `image/png` served from the
    // site's own origin is stored XSS.
    if (!looksLike(file.mimetype, file.buffer)) {
      return { ok: false, error: "That file is not the kind of file it claims to be." };
    }

    const stored = await this.blobs.put(file.buffer);
    const asset = await this.assets.create({
      blobHash: stored.hash,
      filename: safeName(file.originalname),
      contentType: file.mimetype,
      bytes: stored.bytes,
    });

    return { ok: true, asset, deduplicated: stored.existed };
  }

  setAlt(id: string, alt: string): Promise<boolean> {
    return this.assets.setAlt(id, alt);
  }

  /**
   * Delete the row, and the bytes only if nothing else points at them.
   *
   * Content addressing means two uploads of one photo share a blob; deleting
   * the file with the first row would break the second.
   */
  async remove(id: string): Promise<boolean> {
    const row = await this.assets.remove(id);
    if (!row) return false;

    if ((await this.assets.blobUses(row.blobHash)) === 0) await this.blobs.remove(row.blobHash);
    return true;
  }
}

/**
 * Does the content match the declared type?
 *
 * Magic numbers, checked for the formats served inline. A mismatch is refused
 * rather than corrected, because a file lying about its type is either broken
 * or hostile and neither should be stored.
 */
function looksLike(contentType: string, data: Buffer): boolean {
  const starts = (...bytes: number[]) => bytes.every((byte, i) => data[i] === byte);

  switch (contentType) {
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47);
    case "image/gif":
      return starts(0x47, 0x49, 0x46, 0x38);
    case "application/pdf":
      return starts(0x25, 0x50, 0x44, 0x46);
    // Both are RIFF/ISO-BMFF containers whose marker sits at offset 8.
    case "image/webp":
      return starts(0x52, 0x49, 0x46, 0x46) && data.subarray(8, 12).toString() === "WEBP";
    case "image/avif":
      return data.subarray(4, 8).toString() === "ftyp";
    default:
      return false;
  }
}

/** A filename is a label here, never a path — the blob's name is its hash. */
function safeName(name: string): string {
  return name.replace(/[/\\]/g, "-").slice(0, 120) || "file";
}
