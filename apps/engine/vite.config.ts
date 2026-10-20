import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import swc from "unplugin-swc";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { kickjsVitePlugin, envWatchPlugin } from "@forinda/kickjs-vite";

/**
 * The admin's pages (ADR 0051). Vite's oxc compiles them, so `react()` can
 * hot-swap a component on save; swc compiles everything else, because the
 * server needs decorator metadata and oxc does not emit it.
 */
const client = /src\/client\/.+\.[jt]sx?$/;

export default defineConfig({
  oxc: { include: client },
  plugins: [
    // swc's own `config` hook switches oxc off for every file; dropping it is
    // what lets the pages keep oxc.
    { ...swc.vite({ exclude: [/node_modules/, client] }), config: undefined },
    react(),
    tailwind(),
    kickjsVitePlugin({ entry: "src/index.ts" }),
    // Watches .env files and triggers a full reload on change so the
    // dev server picks up env tweaks without a manual restart.
    envWatchPlugin(),
  ],
  // The server writes the HTML, so Vite has no index.html to find the pages'
  // dependencies from — name the entry, and the CommonJS ones it cannot scan.
  optimizeDeps: {
    entries: ["src/client/main.tsx"],
    include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
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
