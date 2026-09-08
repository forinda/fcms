#!/usr/bin/env node
/**
 * `npx forinda-cms` (ADR 0046).
 *
 * The whole no-Docker install: Node, a Postgres URL, one command. Migrations
 * run on boot and the first owner is created there too, so this has nothing to
 * orchestrate — it points the server at the files packed beside it and gets out
 * of the way.
 *
 * Everything is configured by environment variables, the same ones the compose
 * file sets. A flag would be a second way to say the same thing, and the two
 * would disagree the first time somebody set both.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");

const REQUIRED = ["DATABASE_URL"];
const missing = REQUIRED.filter((name) => !process.env[name]);

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`forinda-cms — run a site

  DATABASE_URL      postgres://user:pass@host:5432/database   (required)
  PORT              default 8080
  ORG_ID, SITE_ID   default "default"
  SITE_NAME         what the first site is called
  OWNER_EMAIL       created once, on first boot, with
  OWNER_PASSWORD    at least 12 characters
  MEDIA_DIR         where uploads are written (default ./media)
  SECURE_COOKIES    true behind HTTPS
  TRUST_PROXY       true behind a reverse proxy

Migrations run on boot. Booting again changes nothing.`);
  process.exit(0);
}

if (missing.length > 0) {
  console.error(`forinda-cms: ${missing.join(", ")} is not set.`);
  console.error("Point it at a Postgres database and try again:");
  console.error("  DATABASE_URL=postgres://user:pass@localhost:5432/forinda npx forinda-cms");
  console.error("Run with --help for everything else it reads.");
  process.exit(1);
}

// Where the packed parts are, unless somebody has said otherwise. Set rather
// than resolved by the server, because after publishing they are beside this
// file and nowhere the server would guess.
process.env["MIGRATIONS_DIR"] ??= join(pkg, "migrations");
process.env["ADMIN_DIST"] ??= join(pkg, "app");
process.env["PORT"] ??= "8080";
process.env["NODE_ENV"] ??= "production";

const server = join(pkg, "dist/index.js");
if (!existsSync(server)) {
  console.error("forinda-cms: this install has no server build in it.");
  console.error("That is a packaging fault, not something you can fix — please report it.");
  process.exit(1);
}

await import(server);
