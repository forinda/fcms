/**
 * @forinda-cms/db — the model, and the connection to it.
 *
 * Tables, their row types, the migration planner and the pool. Nothing that
 * *decides* anything: repositories and use-cases live in the app beside the
 * controllers that call them, both because that is where the reference
 * architecture puts them and because a class outside `src/` is a class the
 * Vite `import.meta.glob` never eagerly imports — so its decorators never run
 * and the container has nothing to inject.
 */
export * from "./schema/index.js";
export * from "./client.js";
export * from "./scope.js";
export * from "./planner.js";
export * from "./migrate.js";
