/**
 * Where the link and the token live.
 *
 * Two properties are worth a test because getting them wrong is quiet: a token
 * must never be written into the project directory, and an expired one must
 * read as absent rather than be sent and rejected.
 */
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  credentialsPath,
  forgetToken,
  normalize,
  readLink,
  readToken,
  writeLink,
  writeToken,
} from "./config.js";

const URL_ = "http://localhost:8812";
let home: string;
let project: string;
const original = process.env["XDG_CONFIG_HOME"];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fcms-home-"));
  project = mkdtempSync(join(tmpdir(), "fcms-proj-"));
  process.env["XDG_CONFIG_HOME"] = home;
});

afterEach(() => {
  if (original === undefined) delete process.env["XDG_CONFIG_HOME"];
  else process.env["XDG_CONFIG_HOME"] = original;
});

describe("the link", () => {
  it("round-trips, and holds nothing secret", () => {
    writeLink(project, { url: URL_ });
    expect(readLink(project)).toEqual({ url: URL_ });

    // The whole file, so a token added here later fails this test.
    expect(JSON.parse(readFileSync(join(project, "fcms.json"), "utf8"))).toEqual({ url: URL_ });
  });

  it("is absent rather than an error when a directory is not linked", () => {
    expect(readLink(project)).toBeNull();
  });
});

describe("the token", () => {
  const entry = { token: "t0ken", expiresAt: future(), email: "owner@example.test" };

  it("is stored under the config directory, never in the project", () => {
    writeToken(URL_, entry);
    expect(credentialsPath().startsWith(home)).toBe(true);
    expect(readLink(project)).toBeNull();
  });

  it("is written 0600, because a token is a password", () => {
    const path = writeToken(URL_, entry);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("is keyed per server, so two installs do not overwrite each other", () => {
    writeToken(URL_, entry);
    writeToken("https://other.example", { ...entry, token: "other" });

    expect(readToken(URL_)).toBe("t0ken");
    expect(readToken("https://other.example")).toBe("other");
  });

  it("ignores a trailing slash, which is what people paste", () => {
    writeToken(`${URL_}/`, entry);
    expect(readToken(URL_)).toBe("t0ken");
    expect(normalize(`${URL_}///`)).toBe(URL_);
  });

  it("reads an expired token as absent", () => {
    // Sending it would fail as a 401 on a request the user thought was
    // authenticated; absent sends them to `fcms login` instead.
    writeToken(URL_, { ...entry, expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(readToken(URL_)).toBeNull();
  });

  it("forgets one server without touching another", () => {
    writeToken(URL_, entry);
    writeToken("https://other.example", { ...entry, token: "other" });
    forgetToken(URL_);

    expect(readToken(URL_)).toBeNull();
    expect(readToken("https://other.example")).toBe("other");
  });

  it("treats a corrupt credentials file as no credentials", () => {
    writeToken(URL_, entry);
    writeFileSync(credentialsPath(), "{not json", "utf8");
    expect(readToken(URL_)).toBeNull();
  });
});

function future(): string {
  return new Date(Date.now() + 60_000).toISOString();
}
