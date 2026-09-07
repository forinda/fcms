/**
 * `logic` — trigger plus ordered steps, drawn from an action registry.
 *
 * This is where "run my business on it" lives, and it is the part headless CMSes
 * do not have (doc 03 §6). Actions come from the registry — core in Phase 0,
 * plugins in Phase 2 — which is what makes a plugin's work immediately usable by
 * the AI rather than a feature a human must learn (doc 05 §2).
 */
import { z } from 'zod'

import { Key, Label, TemplateString } from './primitives.js'
import { When } from './condition.js'

export const Trigger = z.discriminatedUnion('on', [
  z.object({ on: z.literal('entry.created'), type: Key }).strict(),
  z.object({ on: z.literal('entry.updated'), type: Key }).strict(),
  /** Fires on a declared `state` transition (ADR 0009 §4). */
  z.object({ on: z.literal('entry.transitioned'), type: Key, to: Key.optional() }).strict(),
  z.object({ on: z.literal('form.submitted'), form: Key }).strict(),
  z.object({ on: z.literal('flow.completed'), flow: Key }).strict(),
  /** Cron, run by the platform. Not a loop the author writes. */
  z.object({ on: z.literal('schedule'), cron: z.string() }).strict(),
])

export const Step = z
  .object({
    action: Key,
    /** Values interpolate via the weak template language — `{{ entry.email }}`. */
    params: z.record(z.string(), z.union([TemplateString, z.number(), z.boolean(), z.null()])).optional(),
    when: When.optional(),
  })
  .strict()

export const Workflow = z
  .object({
    key: Key,
    label: Label.optional(),
    trigger: Trigger,
    steps: z.array(Step).min(1),
    enabled: z.boolean().default(true),
  })
  .strict()

export type Workflow = z.infer<typeof Workflow>
