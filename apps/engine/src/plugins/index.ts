/**
 * Installed plugins, and the block registry the app renders with.
 *
 * Mounting a plugin is `pnpm add` plus one line in `INSTALLED` — the same shape
 * modules and adapters already use, and deliberately not a loader that imports
 * a path out of the database. v1 is ADR 0021 §5's "in-process, reviewed" tier:
 * a block's `render` is code, so installing one is a code review and a deploy.
 * That is a feature at this stage, not a missing feature.
 *
 * `BLOCKS` is what `renderPage` and the admin palette read, so a mounted block
 * is immediately renderable, immediately in the inspector, and immediately
 * offered to the AI — the registry was always the thing they all enumerate.
 */
import { mountPlugins, type Plugin } from "@forinda-cms/plugin";

/** Add an installed plugin here. Nothing else is needed to mount it. */
export const INSTALLED: readonly Plugin[] = [];

const result = mountPlugins(INSTALLED);

export const BLOCKS = result.registry;
export const MOUNTED = result.mounted;
export const REFUSED = result.refused;

/**
 * Refusals are loud but never fatal (ADR 0021 §4). One mistyped manifest must
 * not take a site off the internet: the rest mount, the block that plugin
 * provided renders as an unknown block, and the operator gets a line naming
 * what to fix.
 */
for (const { plugin, reason } of REFUSED) {
  console.error(`[plugin] refused "${plugin}": ${reason}`);
}
