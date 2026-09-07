/**
 * The authenticated surface.
 *
 * Separate module from the site so the two trees keep separate defaults: this
 * one denies unless a route is flagged, the site one is public wholesale
 * (ADR 0008 §4).
 */
import { defineModule } from "@forinda/kickjs";

import { Actor } from "@/contributors";
import { AdminController } from "./admin.controller";

import.meta.glob(["./**/*.controller.ts", "./**/*.service.ts"], { eager: true });

export const AdminModule = defineModule({
  name: "AdminModule",
  build: () => ({
    contributors: () => [Actor.registration],
    routes() {
      // Its own prefix, not `/`. The site module answers `/*path`, so anything
      // sharing its mount is swallowed by the catch-all — and a prefix is the
      // honest expression of ADR 0008 §4's split anyway: one tree is public,
      // one denies, and the URL says which.
      return { path: "/admin", controller: AdminController };
    },
  }),
});
