export * from "./migrate.adapter";

import { MigrateAdapter } from "./migrate.adapter";

/** Instances, not factories — `bootstrap({ adapters })` takes the invoked form. */
export const adapters = [MigrateAdapter()];
