/**
 * The blob store.
 *
 * Content addressing is the whole design (ADR 0010), so the properties worth
 * holding are the ones that follow from it: the same bytes are one file, the
 * path is derived rather than supplied, and a hash from a URL cannot escape the
 * directory.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { diskStorage } from "@forinda/kickjs-storage/disk";

import { BlobStore } from "../blob-store";

let store: BlobStore;
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fcms-blobs-"));
  store = new BlobStore(diskStorage({ root }));
});

describe("storing bytes", () => {
  it("writes once and reads back", async () => {
    const { hash, existed } = await store.put(Buffer.from("hello"));

    expect(existed).toBe(false);
    expect(await store.read(hash)).toEqual(Buffer.from("hello"));
  });

  it("stores the same content once, however many times it arrives", async () => {
    // Two people uploading the same logo is one file and two rows — which is
    // what makes a site transfer copy rows rather than bytes.
    const first = await store.put(Buffer.from("same"));
    const second = await store.put(Buffer.from("same"));

    expect(second.hash).toBe(first.hash);
    expect(second.existed).toBe(true);
  });

  it("writes once when the same bytes arrive at the same moment", async () => {
    // Checking and then writing let both uploads write; the second clobbered
    // the first mid-read. One of them stores it, the other is told it existed.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => store.put(Buffer.from("at once"))),
    );
    expect(results.filter((r) => !r.existed)).toHaveLength(1);
  });

  it("reads what an install stored before kickjs-storage", async () => {
    // Upgrading must not orphan anybody's photos: same root, same `ab/hash`.
    const bytes = Buffer.from("from last year");
    const hash = createHash("sha256").update(bytes).digest("hex");
    mkdirSync(join(root, hash.slice(0, 2)));
    writeFileSync(join(root, hash.slice(0, 2), hash), bytes);

    expect(await store.read(hash)).toEqual(bytes);
    expect((await store.put(bytes)).existed).toBe(true);
  });

  it("shards by prefix, because a flat directory of fifty thousand files is slow", async () => {
    const { hash } = await store.put(Buffer.from("shard me"));
    expect(readdirSync(root)).toEqual([hash.slice(0, 2)]);
  });

  it("rejects a hash with nothing stored under it, so the caller can 404", async () => {
    await expect(store.read("0".repeat(64))).rejects.toThrow();
  });

  it("refuses a hash that is not one, rather than building a path from it", async () => {
    // The hash arrives from a URL. A path built from unvalidated input is a
    // directory traversal.
    await expect(store.read("../../etc/passwd")).rejects.toThrow(/content hash/);
    await expect(store.read("")).rejects.toThrow(/content hash/);
  });

  it("forgets bytes when asked, and shrugs when they are already gone", async () => {
    const { hash } = await store.put(Buffer.from("temporary"));
    await store.remove(hash);
    expect(await store.has(hash)).toBe(false);
    await expect(store.remove(hash)).resolves.toBeUndefined();
  });
});
