/**
 * Uploading, deduplicating and deleting.
 *
 * The security-relevant half is the upload gate: an allowlist of types, a size
 * cap, and a check that the bytes are what the browser claimed. A CMS serving
 * uploaded files from the site's own origin gets exactly one chance to get that
 * wrong.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { assets, closeAllPools, createDb, organizations, sites } from "@forinda-cms/db";

import { AssetRepository } from "@/shared/repositories/asset.repository";
import { MediaUseCase } from "../use-cases/media.usecase";
import { defaultMediaDir } from "@/config";

const url = process.env["DATABASE_URL"];
const suite = url ? describe : describe.skip;
const db = url ? createDb(url) : (undefined as never);

const ORG = "org_media";
const SITE = "site_media";

/** A 1×1 PNG, small enough to inline and real enough to pass the magic check. */
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082",
  "hex",
);

suite("media", () => {
  let uploads: MediaUseCase;

  beforeEach(async () => {
    await db.delete(assets).where(eq(assets.orgId, ORG));
    await db.delete(sites).where(eq(sites.orgId, ORG));
    await db.delete(organizations).where(eq(organizations.id, ORG));
    await db.insert(organizations).values({ id: ORG, name: "Media org" });
    await db.insert(sites).values({ id: SITE, orgId: ORG, slug: "media", name: "Media" });

    process.env["MEDIA_DIR"] = mkdtempSync(join(tmpdir(), "fcms-media-"));
    uploads = new MediaUseCase(new AssetRepository(db, { orgId: ORG, siteId: SITE }));
  });

  const upload = (over: Partial<{ buffer: Buffer; originalname: string; mimetype: string }> = {}) =>
    uploads.upload({ buffer: PNG, originalname: "logo.png", mimetype: "image/png", ...over });

  it("stores a picture and reads it back", async () => {
    const result = await upload();
    expect(result.ok).toBe(true);

    const asset = result.ok ? result.asset : null;
    expect(await uploads.read(asset!.blobHash)).toEqual(PNG);
  });

  it("stores the same picture once, however many times it is uploaded", async () => {
    const first = await upload();
    const second = await upload({ originalname: "copy.png" });

    // Two rows, one blob — the property ADR 0010 wants for site transfers.
    expect(second.ok && second.deduplicated).toBe(true);
    expect(first.ok && second.ok && first.asset.blobHash).toBe(
      second.ok ? second.asset.blobHash : "",
    );
    expect((await uploads.list()).length).toBe(2);
  });

  it("refuses a file that is not what it claims to be", async () => {
    // An HTML document uploaded as `image/png` and served from this origin is
    // stored XSS with a friendly extension.
    const result = await upload({ buffer: Buffer.from("<html><script>alert(1)</script>") });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/not the kind of file/);
  });

  it("refuses a type that is not on the list", async () => {
    // SVG especially: it is a script container.
    expect((await upload({ mimetype: "image/svg+xml" })).ok).toBe(false);
    expect((await upload({ mimetype: "text/html" })).ok).toBe(false);
  });

  it("refuses a file over the limit", async () => {
    const huge = Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]);
    const result = await upload({ buffer: huge });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/10 MB/);
  });

  it("keeps the bytes while another row still points at them", async () => {
    const first = await upload();
    const second = await upload({ originalname: "copy.png" });
    const hash = first.ok ? first.asset.blobHash : "";

    expect(await uploads.remove(first.ok ? first.asset.id : "")).toBe(true);
    // Deleting one of two rows that share a blob must not break the other.
    expect(await uploads.read(hash)).toEqual(PNG);

    expect(await uploads.remove(second.ok ? second.asset.id : "")).toBe(true);
    await expect(uploads.read(hash)).rejects.toThrow();
  });

  it("treats a filename as a label, never a path", async () => {
    const result = await upload({ originalname: "../../etc/passwd" });
    expect(result.ok && result.asset.filename).not.toContain("/");
  });
});

afterAll(async () => {
  if (url) await closeAllPools();
});

/**
 * Where uploads go when nobody says.
 *
 * `./data/media` put binary uploads inside the directory an author keeps their
 * content files in — the same collision the database had before it moved to
 * `.fcms`. Moving it is right for a new install and wrong for an existing one,
 * whose pictures would all answer 404, so an install that already has the old
 * directory keeps it.
 */
describe("the default media directory", () => {
  const dirs: string[] = [];
  const cwd = process.cwd();

  afterEach(() => {
    process.chdir(cwd);
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const inEmptyDirectory = (build: (root: string) => void) => {
    const root = mkdtempSync(join(tmpdir(), "fcms-media-default-"));
    dirs.push(root);
    build(root);
    process.chdir(root);
  };

  it("is beside the database on a fresh install", () => {
    inEmptyDirectory(() => undefined);
    expect(defaultMediaDir()).toBe("./.fcms/media");
  });

  it("stays where it was on an install that already has media", () => {
    inEmptyDirectory((root) => mkdirSync(join(root, "data", "media"), { recursive: true }));
    expect(defaultMediaDir()).toBe("./data/media");
  });
});
