export * from "./database.adapter";
export * from "./workflows.adapter";

import { fileURLToPath } from "node:url";

import { getEnv } from "@forinda/kickjs";
import { InertiaAdapter } from "@forinda/kickjs-inertia";
import { StorageAdapter } from "@forinda/kickjs-storage/adapter";
import { diskStorage } from "@forinda/kickjs-storage/disk";

import { roleOf } from "@/shared/roles";
import { DatabaseAdapter } from "./database.adapter";
import { WorkflowsAdapter } from "./workflows.adapter";

/**
 * The admin's pages (ADR 0051).
 *
 * `clientDir` is beside the bundle rather than under the working directory:
 * `npx @forinda/fcms-core` runs from somebody's site directory, where
 * `dist/client` is nothing of ours. Under `kick dev` Vite serves the pages and
 * this is never read.
 *
 * No `errorPage`: given one, the adapter answers *every* browser error with it
 * — the public site's 404 and 500 included, which have their own page.
 */
const pages = InertiaAdapter({
  entry: "src/client/main.tsx",
  clientDir: fileURLToPath(new URL("./client", import.meta.url)),
  title: "Admin",
  head: '<meta name="robots" content="noindex,nofollow">',
  // Every Inertia page is behind the actor contributor, so there is always one.
  share: (ctx) => {
    const actor = ctx.require("actor");
    return { you: { email: actor.email, role: roleOf(actor.role) } };
  },
});

/**
 * Where uploaded bytes go (ADR 0053): `MEDIA_DIR`, beside the database in the
 * install's data directory, so one backup covers both. Binds `STORAGE`, and
 * adds the directory to `/health/ready` — an install that cannot write media
 * is not ready to take an upload.
 */
const media = StorageAdapter({ storage: diskStorage({ root: getEnv("MEDIA_DIR") }) });

/** Instances, not factories — `bootstrap({ adapters })` takes the invoked form. */
export const adapters = [DatabaseAdapter(), WorkflowsAdapter(), media, pages];
