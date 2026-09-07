/**
 * `access` — per-content-type permissions.
 *
 * The *roles* are platform-defined (ADR 0008: viewer, editor, manager, designer,
 * developer) and map onto doc 07's three modes. This section only narrows them
 * per content type — "editors may write Posts but not Services".
 *
 * The enforcement point is the patch classifier, not a screen (ADR 0008). A role
 * is a set of patch operations an actor may propose, so every authoring surface
 * inherits the check without its own copy of it.
 */
import { z } from "zod";

import { Key } from "./primitives.js";

export const SITE_ROLES = ["viewer", "editor", "manager", "designer", "developer"] as const;
export const SiteRole = z.enum(SITE_ROLES);
export type SiteRole = (typeof SITE_ROLES)[number];

export const CONTENT_ACTIONS = ["read", "create", "update", "delete", "publish"] as const;
export const ContentAction = z.enum(CONTENT_ACTIONS);

export const Access = z
  .object({
    /** Content type key → the roles allowed each action. Absent means platform default. */
    types: z.record(Key, z.record(ContentAction, z.array(SiteRole))).optional(),
  })
  .strict();

export type Access = z.infer<typeof Access>;
