/**
 * Mounting: plugins in, one block registry out (ADR 0021 §2–§4).
 *
 * Every check here is a rule about what installing a plugin may *not* do to a
 * site that already works — shadow a core block, collide with another plugin,
 * or register something its manifest never mentioned. They are cheap because
 * the registries were built as registries from Phase 0; they would be a
 * retrofit if they arrived with the first third-party plugin instead.
 */
import { CORE_BLOCKS, type BlockType } from "@forinda-cms/render";

import { SUPPORTED_PLUGIN_APIS } from "./manifest.js";
import type { Plugin } from "./plugin.js";

export interface Refusal {
  readonly plugin: string;
  readonly reason: string;
}

export interface Mounted {
  /** Core blocks plus every block that mounted. Pass to `renderPage`. */
  readonly registry: Record<string, BlockType>;
  readonly mounted: readonly Plugin[];
  /** Refused plugins, with a reason a human can act on. Never thrown. */
  readonly refused: readonly Refusal[];
}

/**
 * A plugin's contributions must be prefixed with its own name.
 *
 * One rule, three jobs: two plugins cannot collide, no plugin can redefine what
 * `form` means on a site it did not write, and a block name in a spec says
 * where it came from without a lookup.
 */
const owns = (plugin: string, name: string) => name.startsWith(`${plugin}-`);

function check(plugin: Plugin, taken: Record<string, BlockType>): string | null {
  const { name, api, provides } = plugin.manifest;

  if (!SUPPORTED_PLUGIN_APIS.includes(api)) {
    return `needs plugin API ${api}; this core supports ${SUPPORTED_PLUGIN_APIS.join(", ")}`;
  }

  const registered = plugin.blocks.map((b) => b.name);
  const declared = provides.blocks;

  for (const block of registered) {
    if (!owns(name, block)) {
      return `block "${block}" is not namespaced — a plugin's blocks must start with "${name}-"`;
    }
    if (!declared.includes(block)) {
      return `block "${block}" is registered but not declared in provides.blocks`;
    }
    if (block in taken) {
      return `block "${block}" is already registered`;
    }
  }
  for (const block of declared) {
    if (!registered.includes(block)) {
      return `provides.blocks names "${block}", but nothing registers it`;
    }
  }
  return null;
}

/**
 * @param core Defaults to `CORE_BLOCKS`. Passed in by tests, and by anything
 *   that needs to mount against a registry it assembled itself.
 */
export function mountPlugins(
  plugins: readonly Plugin[],
  core: Record<string, BlockType> = CORE_BLOCKS,
): Mounted {
  const registry: Record<string, BlockType> = { ...core };
  const mounted: Plugin[] = [];
  const refused: Refusal[] = [];
  const seen = new Set<string>();

  for (const plugin of plugins) {
    const name = plugin.manifest.name;
    // Two copies of one plugin is a dependency mistake, not a merge to attempt.
    const reason = seen.has(name) ? "already mounted" : check(plugin, registry);
    seen.add(name);
    if (reason) {
      refused.push({ plugin: name, reason });
      continue;
    }
    for (const block of plugin.blocks) registry[block.name] = block;
    mounted.push(plugin);
  }

  return { registry, mounted, refused };
}
