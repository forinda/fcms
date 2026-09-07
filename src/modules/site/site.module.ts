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

import { ResolveSite } from "@/contributors";
import { SiteController } from "./site.controller";

import.meta.glob(["./**/*.controller.ts", "./**/*.service.ts"], { eager: true });

export const SiteModule = defineModule({
  name: "SiteModule",
  build: () => ({
    // Module-level rather than per route: every route here needs the site, and
    // a contributor nobody can forget to apply beats one applied precisely
    // (ADR 0008).
    contributors: () => [ResolveSite.registration],
    // The mount prefix lives here, not on `@Controller()` — v4 moved it, and
    // the decorator's path argument is OpenAPI metadata only.
    routes() {
      return { path: "/", controller: SiteController };
    },
  }),
});
