/**
 * Where uploaded bytes live.
 *
 * Content-addressed on disk, which ADR 0010 already chose for the rows: the
 * path *is* the hash, so uploading the same photo twice writes one blob and two
 * rows, and a site transfer copies rows rather than bytes.
 *
 * Local disk rather than S3 for now, deliberately. Doc 14's install is one
 * container and a database on a small VPS; requiring an object store to upload
 * a logo would put a second service in front of the five-minute install. The
 * interface here is the seam — an S3 implementation is this file again with
 * three methods, and ADR 0013 already chose S3-compatible for the hosted tier.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface StoredBlob {
  readonly hash: string;
  readonly bytes: number;
  /** True when this content was already stored — the caller wrote nothing. */
  readonly existed: boolean;
}

export class BlobStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /**
   * Write bytes, or notice they are already here.
   *
   * The hash is of the content, so this is idempotent: re-uploading a file that
   * exists costs one `stat` and no write.
   */
  async put(data: Buffer): Promise<StoredBlob> {
    const hash = createHash("sha256").update(data).digest("hex");
    const path = this.pathFor(hash);

    if (existsSync(path)) return { hash, bytes: data.byteLength, existed: true };

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return { hash, bytes: data.byteLength, existed: false };
  }

  /**
   * `async` so a bad hash *rejects* rather than throwing synchronously.
   *
   * Callers `await` this; a synchronous throw from an async-looking method
   * skips their `.catch()` and becomes a 500 instead of a 404.
   */
  async read(hash: string): Promise<Buffer> {
    return readFile(this.pathFor(hash));
  }

  has(hash: string): boolean {
    try {
      return existsSync(this.pathFor(hash));
    } catch {
      return false;
    }
  }

  /**
   * Delete the bytes.
   *
   * Only ever called once nothing references the hash — two rows may share one
   * blob, so deleting an asset is not deleting its content.
   */
  async remove(hash: string): Promise<void> {
    await unlink(this.pathFor(hash)).catch(() => undefined);
  }

  /**
   * `ab/abcdef…` — two levels, because a flat directory with fifty thousand
   * files in it is a directory every tool becomes slow in.
   *
   * The hash is validated rather than trusted: it reaches this from a URL, and
   * a path built from unvalidated input is a directory traversal.
   */
  private pathFor(hash: string): string {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("not a content hash");
    return join(this.root, hash.slice(0, 2), hash);
  }
}
