/**
 * The classes both surfaces share: the repositories, the session use-cases, and
 * the reads every screen starts from.
 *
 * Re-exported from one file so a single import registers all of them — they
 * live outside `src/modules`, where no module's `import.meta.glob` can find
 * them, and an unregistered decorated class fails as `No provider for X` at the
 * first request rather than at boot.
 */
export * from "./db";
export * from "./repositories";
export * from "./use-cases";
export * from "./auth/auth.usecase";
export * from "./auth/passwords";
export * from "./auth/tokens";
