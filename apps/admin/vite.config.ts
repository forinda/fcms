/**
 * The admin application (ADR 0044, ADR 0045).
 *
 * Built to `dist/client` and served by the engine under `/app/`, which is why
 * `base` is set: every asset URL has to resolve under that prefix, and a hash
 * router to avoid saying so would put `#` in every address somebody bookmarks.
 *
 * In development this is a separate server that proxies the engine, so a save
 * here reloads in milliseconds without restarting the API — and the cookie the
 * engine set is sent along, because the proxy makes both same-origin.
 */
import { resolve } from "node:path";

import { reactRouter } from "@react-router/dev/vite";
import tailwind from "@tailwindcss/vite";
import { defineConfig } from "vite";

const ENGINE = process.env["ENGINE_URL"] ?? "http://localhost:8800";

export default defineConfig({
  base: "/app/",
  plugins: [tailwind(), reactRouter()],
  // `@/` is what shadcn's generated components import themselves by, so it is
  // part of the contract rather than a preference.
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
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
});
