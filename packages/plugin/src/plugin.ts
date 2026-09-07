/**
 * `definePlugin` — the whole surface a plugin author imports.
 *
 * A plugin never sees the engine, the database or a repository. It contributes
 * `BlockType` values, which is exactly what core contributes, and a block
 * receives `BlockContext` and returns `Html`. The extent of a plugin's
 * authority is the shape of that function (ADR 0021 §1).
 *
 * The factory validates the manifest at definition time so a typo fails where
 * it was written rather than at mount on someone else's server.
 */
import type { BlockType } from "@forinda-cms/render";

import { Manifest } from "./manifest.js";

export interface PluginInput {
  readonly manifest: unknown;
  readonly blocks?: readonly BlockType[];
}

export interface Plugin {
  readonly manifest: Manifest;
  readonly blocks: readonly BlockType[];
}

export function definePlugin(input: PluginInput): Plugin {
  const parsed = Manifest.safeParse(input.manifest);
  if (!parsed.success) {
    const where = parsed.error.issues
      .map((i) => `${i.path.join(".") || "manifest"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid plugin manifest — ${where}`);
  }
  return { manifest: parsed.data, blocks: input.blocks ?? [] };
}
