import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { fileURLToPath } from "node:url";

/**
 * Load the repo's `.env.test` before the suite runs.
 *
 * `.env.test` is the project's convention for test credentials. The app gets it
 * from the framework's env loader; a package running under plain vitest has to
 * ask, and without this `DATABASE_URL` would be whatever is in the shell —
 * usually the development database, which these suites truncate.
 *
 * **The shell wins.** A committed default cannot be right on every machine (a
 * password, a port), so an explicitly-exported variable overrides the file
 * rather than the other way round. The file supplies the default; the developer
 * supplies the exception.
 */
const root = fileURLToPath(new URL("../..", import.meta.url));
for (const [key, value] of Object.entries(loadEnv("test", root, ""))) {
  process.env[key] ??= value;
}

export default defineConfig({
  test: { globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
