/**
 * `logic` — trigger plus ordered steps, drawn from an action registry.
 *
 * This is where "run my business on it" lives, and it is the part headless CMSes
 * do not have (doc 03 §6). Actions come from the registry — core in Phase 0,
 * plugins in Phase 2 — which is what makes a plugin's work immediately usable by
 * the AI rather than a feature a human must learn (doc 05 §2).
 */
import { z } from "zod";

import { Key, Label, Note, TemplateString } from "./primitives.js";
import { When } from "./condition.js";

/**
 * The actions core implements (ADR 0024).
 *
 * A closed list here for the same reason `INTEGRATION_KINDS` is one: a step
 * naming an action nobody implements is a workflow that silently does nothing,
 * and the owner finds out when the thing they automated did not happen. The
 * runner reads the same names, and a plugin adding one is an additive change to
 * this list (ADR 0021 §"consequences").
 *
 * Everything that needs a credential — email, SMS — is deliberately absent
 * until it has a provider behind it, because an action that cannot run is worse
 * than an action that does not exist.
 */
export const ACTIONS = [
  /** Move an entry's `state` field along a declared transition. */
  "entry.transition",
  /** Post the trigger's entry to a `webhook` integration. */
  "webhook.post",
  /**
   * Call a declared `api` integration and keep what it answered (ADR 0029 §4).
   *
   * The address is the integration's, never the step's: a step carrying its own
   * URL is an exfiltration channel a spec edit adds invisibly.
   */
  "http.request",
  /**
   * The escape hatch: a script, in a process that can reach nothing (ADR 0031).
   *
   * Declarative steps cover mapping, calling and moving things along. They do
   * not cover "work out the VAT and split it by line item", and a pipeline
   * without an escape hatch sends that work back to whoever maintains the
   * platform.
   */
  "script.run",
  /** Text somebody, through an `sms` integration (ADR 0032). */
  "sms.send",
  /** Email somebody, through an `email` integration. */
  "email.send",
] as const;

export type ActionName = (typeof ACTIONS)[number];

export const Trigger = z.discriminatedUnion("on", [
  z.object({ on: z.literal("entry.created"), type: Key }).strict(),
  z.object({ on: z.literal("entry.updated"), type: Key }).strict(),
  /** Fires on a declared `state` transition (ADR 0009 §4). */
  z.object({ on: z.literal("entry.transitioned"), type: Key, to: Key.optional() }).strict(),
  z.object({ on: z.literal("form.submitted"), form: Key }).strict(),
  z.object({ on: z.literal("flow.completed"), flow: Key }).strict(),
  /**
   * Money arrived (ADR 0023).
   *
   * The trigger that makes "confirm the booking once the deposit is paid"
   * expressible. Only ever fired by the platform confirming a payment with the
   * provider — never by a callback body.
   */
  z.object({ on: z.literal("payment.succeeded"), type: Key.optional() }).strict(),
  /** Cron, run by the platform. Not a loop the author writes. */
  z.object({ on: z.literal("schedule"), cron: z.string() }).strict(),
]);

/**
 * An action name: `namespace.verb`.
 *
 * Not a `Key`, which is kebab-case and has no dots — every action ever written
 * down, here and in ADR 0005/0009, is `entry.transition` or `email.send`, and
 * the schema said otherwise for as long as nothing ran them. Found by writing
 * the runner (ADR 0024).
 */
export const ActionKey = z
  .string()
  .regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/, "an action name, like `entry.transition`");

export const Step = z
  .object({
    /**
     * A name for this step's output, so a later one can read it (ADR 0029 §2).
     *
     * Optional, because a step nothing reads needs none — the two-step
     * automation from ADR 0024 keeps working without growing ceremony.
     */
    key: Key.optional(),
    action: ActionKey,
    /**
     * Values interpolate via the weak template language — `{{ entry.email }}`,
     * `{{ steps.customer.body.id }}`.
     *
     * The same evaluator the renderer uses, with the same ceiling ADR 0001 set:
     * property access and one formatter, no expressions and no calls. Every
     * automation tool eventually grows a mapping language; the ones that grew
     * it by accident are the ones nobody can sandbox afterwards.
     */
    params: z
      .record(z.string(), z.union([TemplateString, z.number(), z.boolean(), z.null()]))
      .optional(),
    when: When.optional(),
  })
  .strict();

export const Workflow = z
  .object({
    key: Key,
    label: Label.optional(),
    trigger: Trigger,
    steps: z.array(Step).min(1),
    enabled: z.boolean().default(true),
    note: Note,
  })
  .strict();

export type Workflow = z.infer<typeof Workflow>;
