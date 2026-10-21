/**
 * Where uploaded bytes live.
 *
 * Content-addressed on disk, which ADR 0010 already chose for the rows: the
 * path *is* the hash, so uploading the same photo twice writes one blob and two
 * rows, and a site transfer copies rows rather than bytes.
 *
 * Local disk by default, deliberately. Doc 14's install is one container and
 * a database on a small VPS; requiring an object store to upload a logo would
 * put a second service in front of the five-minute install. ADR 0013 chose
 * S3-compatible for the hosted tier, which is now a different `STORAGE`
 * binding rather than a second implementation of this file.
 */
import { createHash } from "node:crypto";
import { Inject, Service } from "@forinda/kickjs";
import type { Storage } from "@forinda/kickjs-storage";
import { STORAGE } from "@forinda/kickjs-storage/adapter";

export interface StoredBlob {
  readonly hash: string;
  readonly bytes: number;
  /** True when this content was already stored — the caller wrote nothing. */
  readonly existed: boolean;
}

/**
 * Content addressing over whatever `STORAGE` is (ADR 0053).
 *
 * This file decides the keys and nothing else: the bytes go through
 * kickjs-storage, which is local disk today (`diskStorage`, registered with
 * the adapters) and a bucket once an install sets one up — without this file
 * or its callers changing.
 */
@Service()
export class BlobStore {
  constructor(@Inject(STORAGE) private readonly storage: Storage) {}

  /**
   * Write bytes, or notice they are already here.
   *
   * The hash is of the content, so this is idempotent — and `putIfAbsent` makes
   * it atomic: two uploads of the same photo at once write it once between
   * them, where checking and then writing let both write.
   */
  async put(data: Buffer): Promise<StoredBlob> {
    const hash = createHash("sha256").update(data).digest("hex");
    const stored = await this.storage.putIfAbsent(keyFor(hash), data);
    return { hash, bytes: data.byteLength, existed: !stored };
  }

  /**
   * Rejects for a bad hash or a missing blob, rather than throwing
   * synchronously or resolving empty: callers turn a rejection into a 404,
   * and a synchronous throw from an async-looking method skips their
   * `.catch()` and becomes a 500.
   */
  async read(hash: string): Promise<Buffer> {
    const bytes = await this.storage.get(keyFor(hash));
    if (!bytes) throw new Error("no such blob");
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  async has(hash: string): Promise<boolean> {
    try {
      return await this.storage.exists(keyFor(hash));
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
    await this.storage.delete(keyFor(hash));
  }
}

/**
 * `ab/abcdef…` — two levels, because a flat directory with fifty thousand
 * files in it is a directory every tool becomes slow in. The same layout the
 * store used before kickjs-storage, so existing installs' files stay where
 * they are.
 *
 * The hash is validated rather than trusted: it reaches this from a URL, and
 * a key built from unvalidated input is a directory traversal on disk.
 */
function keyFor(hash: string): string {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("not a content hash");
  return `${hash.slice(0, 2)}/${hash}`;
}
