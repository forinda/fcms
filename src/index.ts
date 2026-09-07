import "reflect-metadata";
// Side-effect import, and it must come first: it registers the env schema
// before any `@Value` or `ConfigService.get` resolves. Without it those return
// undefined and Zod's coercion and defaults are silently skipped.
import "./config";
import { bootstrap, expressRuntime } from "@forinda/kickjs";

import { modules } from "./modules";

/**
 * A website, not an API.
 *
 * KickJS defaults to mounting routes at `/{apiPrefix}/v{version}/{path}` —
 * sensible for the API it is usually used to build, and wrong here: a public
 * site cannot live under `/api/v1`, and neither can `robots.txt` or
 * `sitemap.xml`, which crawlers only ever look for at the root.
 *
 * So both are switched off. A future admin or MCP surface can opt *into*
 * versioning per module, which is the right way round — the thing with an
 * external contract versions itself, the public pages do not.
 */
export const app = await bootstrap({
  modules,
  runtime: expressRuntime(),
  apiPrefix: "",
  defaultVersion: false,
});
