/**
 * @forinda-cms/plugin — the contract, and nothing else.
 *
 * This is the package a plugin author installs from npm (ADR 0021 §6). It
 * carries `definePlugin`, the manifest schema and the mount rules; the engine,
 * the AI layer and the admin stay closed. Publishing the contract is what lets
 * someone build against it — publishing the implementation would give it away.
 */
export * from "./manifest.js";
export * from "./plugin.js";
export * from "./mount.js";
