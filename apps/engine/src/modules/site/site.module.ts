/**
 * The site module.
 *
 * Two contracts, both silent when broken:
 *
 *   - The filename must end `.module.ts`. The Vite plugin scans for
 *     `*.module.[tj]sx?` to drive graceful HMR; a misnamed file turns every
 *     save into a full restart.
 *   - `import.meta.glob` must eagerly import every decorated class, or the
 *     decorators never fire and the routes do not exist. `kick typegen` still
 *     reports them, because it reads the source rather than the runtime — which
 *     is what makes this one hard to spot.
 */
import { defineModule } from "@forinda/kickjs";

import { AccountController } from "./account.controller";
import { SubmissionController } from "./submission.controller";
import { SiteController } from "./site.controller";

// Eagerly import every file in the module so decorators run and register in
// the container. Broad by design, the way `kick g module` generates it: a
// suffix list only covers the names that existed when it was written, and the
// `*.usecase.ts` files added later registered nothing — which surfaces as
// `No provider for X` at the first request, not at boot.
import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./**/*.d.ts"], { eager: true });

export const SiteModule = defineModule({
  name: "SiteModule",
  build: () => ({
    // The mount prefix lives here, not on `@Controller()` — v4 moved it, and
    // the decorator's path argument is OpenAPI metadata only.
    routes() {
      // Accounts before the site's catch-all, which answers `/*path` and would
      // otherwise swallow them.
      return [
        { path: "/", controller: AccountController },
        { path: "/", controller: SubmissionController },
        { path: "/", controller: SiteController },
      ];
    },
  }),
});
