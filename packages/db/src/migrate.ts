#!/usr/bin/env tsx
/**
 * Run migrations.
 *
 * Drizzle's migrator keeps its ledger inside the target database, which makes
 * this **idempotent and resumable** — the property `enaton` relies on for tenant
 * provisioning (doc 09 §6), and the reason doc 09's install artifact can run
 * migrations on boot rather than asking a self-hoster to run a command.
 */
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { closeAllPools, createDb } from "./client.js";

const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
await migrate(createDb(url), { migrationsFolder: join(here, "../migrations") });
await closeAllPools();
console.log("migrations applied");
