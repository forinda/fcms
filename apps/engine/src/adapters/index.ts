export * from "./database.adapter";

import { DatabaseAdapter } from "./database.adapter";

/** Instances, not factories — `bootstrap({ adapters })` takes the invoked form. */
export const adapters = [DatabaseAdapter()];
