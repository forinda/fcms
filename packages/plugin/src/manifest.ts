/**
 * What a plugin declares about itself (ADR 0021 §1, doc 05 §1).
 *
 * The manifest is not documentation. It is what the installer shows an owner in
 * plain language before install, and what the capability-diff guard compares
 * between two versions of the same plugin — a patch release that suddenly wants
 * `network: ["*"]` is the single highest-leverage supply-chain check there is,
 * and it only exists because capabilities are *declared*.
 *
 * Both of those uses are worthless if the manifest may drift from the code, so
 * `mount.ts` checks that what is declared and what is registered agree.
 */
import { Key } from "@forinda-cms/spec";
import { z } from "zod";

/**
 * ADR 0003's plugin API integer. It moves on a break to this contract — years,
 * not releases — and independently of the core version.
 *
 * Core supports the current API and the one before it (N and N−1). Until there
 * is an N−1 to support, that set has one member.
 */
export const PLUGIN_API = "1" as const;
export const SUPPORTED_PLUGIN_APIS: readonly string[] = [PLUGIN_API];

/**
 * Declared, recorded, shown — **not enforced** in v1 (ADR 0021 §5).
 *
 * A block's `render` is code and runs in this process, so nothing here is a
 * boundary yet; it becomes one with the out-of-process worker. The field ships
 * now anyway, because a capability history cannot be reconstructed after the
 * fact, and a diff needs something to diff against.
 */
export const Capabilities = z
  .object({
    /** Egress allowlist — hostnames, never `*`. */
    network: z.array(z.string().min(1)).optional(),
    /** Environment keys the plugin reads. Values never appear in a manifest. */
    secrets: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).optional(),
    entries: z
      .object({ read: z.array(Key).optional(), write: z.array(Key).optional() })
      .strict()
      .optional(),
  })
  .strict();

export const Manifest = z
  .object({
    /** Kebab-case, and the prefix every contribution of this plugin must carry. */
    name: Key,
    /** The plugin's own version — semver, and the plugin author's to choose. */
    version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+].*)?$/, "semver, e.g. 1.2.0"),
    /** The platform contract this plugin was written against. */
    api: z.string().min(1),
    provides: z
      .object({
        blocks: z.array(Key).default([]),
      })
      .strict()
      .default({ blocks: [] }),
    capabilities: Capabilities.default({}),
  })
  .strict();

export type Manifest = z.infer<typeof Manifest>;
