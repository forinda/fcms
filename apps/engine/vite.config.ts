import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import swc from "unplugin-swc";
import { kickjsVitePlugin, envWatchPlugin } from "@forinda/kickjs-vite";

export default defineConfig({
  oxc: false,
  plugins: [
    swc.vite(),
    kickjsVitePlugin({ entry: "src/index.ts" }),
    // Watches .env files and triggers a full reload on change so the
    // dev server picks up env tweaks without a manual restart.
    envWatchPlugin(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    target: "node20",
    ssr: true,
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      input: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      output: { format: "esm" },
      // Packages with native bindings cannot be bundled — the loader reaches
      // for a `.node` binary that is not JavaScript, and the build fails with
      // "stream did not contain valid UTF-8", which reads like a corrupt file
      // rather than what it is.
      //
      // They stay external and are resolved from node_modules at runtime, which
      // is why the Dockerfile ships a real dependency tree rather than only the
      // bundle.
      // Only the packages that genuinely cannot be bundled. `postgres` is pure
      // JavaScript and bundles fine; externalising it as well meant the bundle
      // reached for a package the root does not directly depend on, which pnpm's
      // strict layout does not expose.
      external: [/^@node-rs\//],
    },
  },
});
