/**
 * The routes, as data (React Router 7).
 *
 * A list rather than JSX, so the router can build them before anything renders
 * and a loader can run while the screen is still being fetched.
 */
import { index, layout, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  layout("shell.tsx", [
    index("routes/dashboard.tsx"),
    route("content", "routes/content.tsx"),
    route("content/:type", "routes/entries.tsx"),
    route("content/:type/:id", "routes/entry.tsx"),
    route("*", "routes/not-found.tsx"),
  ]),
] satisfies RouteConfig;
