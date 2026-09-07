/**
 * Two small files: where the site is, and who you are.
 *
 * They are deliberately separate, and separately located. The **link** belongs
 * to the project and is safe to commit — it names a server and nothing secret.
 * The **credentials** belong to the machine and must never be in a repository,
 * so they live under the user's config directory with `0600` on them.
 *
 * Putting a token in the project directory is how tokens end up in git history,
 * and no `.gitignore` entry survives someone copying the folder.
 */
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface Link {
  /** Base URL of the forinda-cms server this directory publishes to. */
  readonly url: string;
}

export const LINK_FILE = "fcms.json";

export function readLink(root: string): Link | null {
  return readJson<Link>(join(root, LINK_FILE));
}

export function writeLink(root: string, link: Link): string {
  const path = join(root, LINK_FILE);
  writeFileSync(path, `${JSON.stringify(link, null, 2)}\n`, "utf8");
  return path;
}

interface Credentials {
  /** Keyed by server URL: one machine, several installs. */
  readonly tokens: Record<string, { token: string; expiresAt: string; email: string }>;
}

/** `$XDG_CONFIG_HOME/forinda-cms/credentials.json`, with the usual fallback. */
export function credentialsPath(): string {
  const base = process.env["XDG_CONFIG_HOME"] || join(homedir(), ".config");
  return join(base, "forinda-cms", "credentials.json");
}

export function readToken(url: string): string | null {
  const creds = readJson<Credentials>(credentialsPath());
  const entry = creds?.tokens?.[normalize(url)];
  if (!entry) return null;

  // An expired token is worse than none: it fails as a 401 from a request the
  // user thought was authenticated.
  if (Date.parse(entry.expiresAt) <= Date.now()) return null;
  return entry.token;
}

export function writeToken(
  url: string,
  entry: { token: string; expiresAt: string; email: string },
): string {
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

  const current = readJson<Credentials>(path) ?? { tokens: {} };
  const next: Credentials = { tokens: { ...current.tokens, [normalize(url)]: entry } };

  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  // Set explicitly as well as on create: an existing file keeps its old mode,
  // and this one may have been written before that mode was here.
  chmodSync(path, 0o600);
  return path;
}

export function forgetToken(url: string): void {
  const path = credentialsPath();
  const current = readJson<Credentials>(path);
  if (!current) return;

  const tokens = { ...current.tokens };
  delete tokens[normalize(url)];

  if (Object.keys(tokens).length === 0) rmSync(path, { force: true });
  else
    writeFileSync(path, `${JSON.stringify({ tokens }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
}

/** One trailing slash should not make a second entry for the same server. */
export function normalize(url: string): string {
  return url.replace(/\/+$/, "");
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    // Missing or malformed both mean "nothing usable here". A corrupt
    // credentials file should send you to `fcms login`, not crash the CLI.
    return null;
  }
}
