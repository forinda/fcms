export * from "./database.adapter";
export * from "./workflows.adapter";

import { DatabaseAdapter } from "./database.adapter";
import { WorkflowsAdapter } from "./workflows.adapter";

/** Instances, not factories — `bootstrap({ adapters })` takes the invoked form. */
export const adapters = [DatabaseAdapter(), WorkflowsAdapter()];
