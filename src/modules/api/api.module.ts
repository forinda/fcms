/**
 * The management API — the one door `fcms` knocks on.
 *
 * ADR 0002 seam 4: *"the CLI talks to the platform through a client library, not
 * through internals"*, so that Phase 1's MCP server is a second consumer rather
 * than a rewrite. This module is the platform side of that boundary; the client
 * side is `@forinda-cms/sdk`.
 *
 * Deliberately not the scriptable half of a CLI (doc 11 §2). These endpoints
 * cover *management* — authenticate, inspect, plan, apply — and there is no bulk
 * content verb here for the same reason `fcms` has none.
 */
import { defineModule } from "@forinda/kickjs";

import { ApiController } from "./api.controller";

import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./**/*.d.ts"], { eager: true });

export const ApiModule = defineModule({
  name: "ApiModule",
  build: () => ({
    // Its own prefix, mounted before the site's catch-all like the admin is.
    routes() {
      return { path: "/api", controller: ApiController };
    },
  }),
});
