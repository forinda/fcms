/**
 * The admin app (ADR 0044).
 *
 * Built to `dist/` and served by the engine under `/app/`, which is why `base`
 * is set: every asset URL has to resolve under that prefix, and a hash-router
 * hack to avoid saying so would put `#` in every address somebody bookmarks.
 *
 * In development this is a separate server that proxies the engine, so a save
 * here reloads in milliseconds without restarting the API — and the cookie the
 * engine set is sent along, because the proxy makes both same-origin.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const ENGINE = process.env["ENGINE_URL"] ?? "http://localhost:8800";

export default defineConfig({
  base: "/app/",
  plugins: [react()],
  server: {
    port: 4330,
    proxy: {
      "/api": { target: ENGINE, changeOrigin: false },
      // The sign-in form is still the engine's: a session is a cookie, and the
      // page that mints one has no reason to be an application.
      "/admin": { target: ENGINE, changeOrigin: false },
      "/media": { target: ENGINE, changeOrigin: false },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
