#!/usr/bin/env node
/**
 * Copy the install artifacts into the marketing site.
 *
 * The engine's source is private, so `raw.githubusercontent.com` 404s for a
 * stranger — and a private repository's *release assets* sit behind the same
 * authentication as its code, so attaching them there does not help either.
 * What is already public is this site.
 *
 * So the install files ship with it: one source of truth in `install/`, copied
 * at build time, served at `/install/…`. Nothing to keep in sync by hand, and
 * no second repository holding a copy that drifts.
 */
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "../../../install");
const to = join(here, "../public/install");

// Everything an installer needs and nothing else: no README (the site says it
// better) and no file that is not part of running the thing.
/**
 * Source name → published name.
 *
 * `.env.example` is published as `env.example`: a leading dot makes a file
 * invisible to static hosts and to Astro's own copy of `public/`, so the
 * dotted name silently 404s. The installer saves it as `.env` regardless.
 */
const FILES = new Map([
  ["compose.yaml", "compose.yaml"],
  [".env.example", "env.example"],
  ["backup.sh", "backup.sh"],
]);

mkdirSync(to, { recursive: true });

const available = new Set(readdirSync(from));
for (const [source, published] of FILES) {
  if (!available.has(source)) {
    // Loud, rather than a site that serves a 404 to everyone who follows the
    // instructions printed on it.
    console.error(`publish-install: ${source} is missing from install/`);
    process.exit(1);
  }
  copyFileSync(join(from, source), join(to, published));
}

console.log(`publish-install: ${FILES.size} files → public/install/`);
