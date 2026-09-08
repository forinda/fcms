/**
 * The authenticated surface.
 *
 * Separate module from the site so the two trees keep separate defaults: this
 * one denies unless a route is flagged, the site one is public wholesale
 * (ADR 0008 §4).
 */
import { defineModule } from "@forinda/kickjs";

import { AdminController } from "./admin.controller";
import { AssistController } from "./assist.controller";
import { AutomationController } from "./automation.controller";
import { CanvasController } from "./canvas.controller";
import { ContentController } from "./content.controller";
import { MediaController } from "./media.controller";
import { TypesController } from "./types.controller";

// Eagerly import every file in the module so decorators run and register in
// the container. Broad by design, the way `kick g module` generates it: a
// suffix list only covers the names that existed when it was written, and the
// `*.usecase.ts` files added later registered nothing — which surfaces as
// `No provider for X` at the first request, not at boot.
import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./**/*.d.ts"], { eager: true });

export const AdminModule = defineModule({
  name: "AdminModule",
  build: () => ({
    routes() {
      // Its own prefix, not `/`. The site module answers `/*path`, so anything
      // sharing its mount is swallowed by the catch-all — and a prefix is the
      // honest expression of ADR 0008 §4's split anyway: one tree is public,
      // one denies, and the URL says which.
      return [
        // Auth first: its `/login` must not be shadowed by the content
        // controller's `/:type` parameter route.
        { path: "/admin", controller: AdminController },
        // Before the content controller: its `/content/:type` would otherwise
        // swallow nothing here, but the canvas's `/pages/:key` is the more
        // specific route and reads better first.
        { path: "/admin", controller: AssistController },
        { path: "/admin", controller: CanvasController },
        // Before the content controller, which owns `/automations` itself: the
        // list lives there, one automation lives here.
        { path: "/admin", controller: AutomationController },
        { path: "/admin", controller: MediaController },
        // Before the content controller, whose `/content/:type` is a different
        // tree: this one is the shape, that one is the rows.
        { path: "/admin", controller: TypesController },
        { path: "/admin", controller: ContentController },
      ];
    },
  }),
});
