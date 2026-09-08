/**
 * React Router 7, framework mode, without a server (ADR 0044).
 *
 * `ssr: false` on purpose. The public site is server-rendered by the engine and
 * always will be — that is where SEO, structured data and a phone on a slow
 * connection live. The admin is the opposite case: it is behind a session, it
 * is never indexed, and rendering it twice would mean a Node process in front
 * of the engine for no reader's benefit.
 *
 * What framework mode still buys without SSR: routes as data, loaders that run
 * before a screen paints, and one build command that emits static files the
 * engine serves under `/app/`.
 */
import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "src",
  buildDirectory: "dist",
  ssr: false,
  basename: "/app",
} satisfies Config;
