#!/usr/bin/env tsx
import { closeAllPools } from "./client.js";
import { migrateFromEnv } from "./migrate.js";

await migrateFromEnv();
await closeAllPools();
console.log("migrations applied");
