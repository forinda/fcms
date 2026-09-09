/**
 * One process per embedded database (ADR 0050).
 *
 * Two processes on one data directory corrupts it permanently: the second boot
 * succeeds and every boot after that dies inside the WASM runtime with
 * `RuntimeError: Aborted()`, with no `pg_ctl` to recover it. It happened —
 * a restart that overlapped its predecessor by a few seconds destroyed a site's
 * database — and PGlite's own `postmaster.pid` cannot prevent it, because the
 * pid it writes is the constant `-42`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createDb } from "./client.js";

const dirs: string[] = [];
const opened: { $client?: { close?: () => Promise<void> } }[] = [];

const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "fcms-lock-"));
  dirs.push(dir);
  return join(dir, "db");
};

const open = (url: string) => {
  const db = createDb(url) as unknown as { $client?: { close?: () => Promise<void> } };
  opened.push(db);
  return db;
};

// Closed before the directory goes, because PGlite starts asynchronously and
// removing the directory out from under it is an unhandled rejection rather
// than a failure anybody can read.
afterEach(async () => {
  for (const db of opened.splice(0)) await db.$client?.close?.().catch(() => undefined);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("opening an embedded database", () => {
  it("refuses a directory another live process holds", () => {
    const dir = scratch();
    open(dir);

    // A different pid, and one that certainly exists: this test's own parent.
    writeFileSync(join(dir, "fcms.lock"), String(process.ppid), "utf8");

    expect(() => open(`${dir}/`)).toThrow(/already open in process/);
  });

  it("takes over a lock whose process is gone", () => {
    // A machine that lost power leaves one behind, and refusing to start until
    // somebody deletes a file they have never heard of is its own data loss.
    const dir = scratch();
    open(dir);
    writeFileSync(join(dir, "fcms.lock"), "2147483646", "utf8");

    expect(() => open(`${dir}/`)).not.toThrow();
    expect(readFileSync(join(dir, "fcms.lock"), "utf8")).toBe(String(process.pid));
  });

  it("leaves a Postgres server alone", () => {
    // The lock is about a directory. A URL is somebody else's problem, and
    // theirs is a real server that can hold as many connections as it likes.
    expect(() => open("postgres://user:pass@localhost:5432/nothing")).not.toThrow();
  });
});
