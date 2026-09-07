import { defineModules } from "@forinda/kickjs";

import { AdminModule } from "./admin/admin.module";
import { SiteModule } from "./site/site.module";

/**
 * Admin first, and on its own prefix.
 *
 * The site module answers `/*path`, so anything mounted after it — or beside it
 * at `/` — is swallowed by the catch-all. The admin has its own prefix for that
 * reason and for a better one: ADR 0008 §4 splits the surfaces, and the URL
 * should say which one a request is in.
 */
export const modules = defineModules().mount(AdminModule()).mount(SiteModule());
