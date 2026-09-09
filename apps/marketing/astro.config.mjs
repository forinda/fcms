// @ts-check
import { defineConfig } from "astro/config";

/**
 * The marketing site.
 *
 * Static output, no adapter, no server: this is the page a stranger reads
 * before they install anything, and it should survive being served from a
 * bucket, a CDN or a spare directory on the same VPS that runs the engine.
 *
 * It is a separate app rather than a route in the engine because the two have
 * opposite lifetimes — marketing copy changes weekly and ships to a CDN, the
 * engine changes on release and ships as a container — and because a marketing
 * page has no business holding a database connection.
 */
export default defineConfig({
  site: "https://fcms.kickjs.app",
  output: "static",
  build: { format: "directory" },
});
