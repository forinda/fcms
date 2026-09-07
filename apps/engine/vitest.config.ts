import { defineConfig, mergeConfig } from "vitest/config";
import { loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import viteConfig from "./vite.config.ts";

/**
 * Load the repo's `.env.test` before the suite runs.
 *
 * At the repo root, not in this app: every workspace suite that touches the
 * database reads the same file, and one set of throwaway credentials for the
 * whole repo is the point of it.
 *
 * The app's own suites live under `src/` now — the repositories, the use-cases
 * and auth moved out of the workspace package — and they talk to a real
 * database. Under `kick dev` the framework's env loader supplies that; plain
 * vitest has to ask, and without this `DATABASE_URL` is whatever is in the
 * shell, usually the development database these suites truncate.
 *
 * **The shell wins.** A committed default cannot be right on every machine, so
 * an exported variable overrides the file rather than the other way round.
 */
for (const [key, value] of Object.entries(
  loadEnv("test", fileURLToPath(new URL("../..", import.meta.url)), ""),
)) {
  process.env[key] ??= value;
}

// A `vitest.config.ts` OVERRIDES `vite.config.ts` outright — vitest does not
// merge the two, and it never reads tsconfig `paths`. Restating settings here
// would mean the `@` alias lives in three files and drifts in two of them, so
// merge the real config instead: the alias, plugins, and ssr externals all come
// from one place.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: "node",
      include: ["src/**/*.test.ts"],
    },
  }),
);
