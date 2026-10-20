/**
 * The production build of the admin's pages (ADR 0051).
 *
 * `pnpm build` runs this after `kick build`, into `dist/client` — beside the
 * server bundle, so the image and the npm package already carry it without a
 * copy of their own. InertiaAdapter reads `.vite/manifest.json` from there for
 * the script tags and serves the rest.
 *
 * No server-side render bundle: the admin is behind a session and never
 * indexed, so a second build would render for nobody.
 */
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The engine's `.env` can set NODE_ENV=development, and a development JSX
// transform fails under the production React the bundle carries.
process.env["NODE_ENV"] = "production";

export default defineConfig({
  // Nothing from the server's environment belongs in a browser bundle.
  envDir: false,
  plugins: [react(), tailwind()],
  build: {
    outDir: "dist/client",
    manifest: true,
    rollupOptions: { input: "src/client/main.tsx" },
  },
});
