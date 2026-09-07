/**
 * `wiring` — integrations declared by kind, with **secrets by reference only**.
 *
 * ADR 0001 forbids a secret value in the spec, and `secret:NAME` is the form that
 * makes it enforceable: the spec names an env key, the platform resolves it.
 * A spec is therefore safe to print, diff, commit and hand to a model.
 */
import { z } from "zod";

import { Key, Label, SecretRef } from "./primitives.js";

/** Payments lead with M-Pesa (ADR 0005 as amended, doc 14) — cards are second, not first. */
export const INTEGRATION_KINDS = [
  "payment.mpesa",
  "payment.card",
  /**
   * Pay on arrival, by bank transfer, in cash — the owner confirms it.
   *
   * Not a placeholder (ADR 0023 §5): it takes no credentials, so it is the only
   * way to charge for something before a business has a shortcode, and it is
   * what most sites want on the day they launch.
   */
  "payment.manual",
  "email",
  "sms",
  "calendar",
  "storage",
  "analytics",
  /**
   * Somewhere to POST to — another system, an automation tool, a Slack hook.
   *
   * A *destination*, declared once, rather than a URL a workflow step carries
   * (ADR 0024 §5). A step that could name any address is an exfiltration
   * channel a spec edit can add invisibly; an integration is in the diff, in
   * one place, and refusable.
   */
  "webhook",
] as const;

export const Integration = z
  .object({
    key: Key,
    kind: z.enum(INTEGRATION_KINDS),
    label: Label.optional(),
    /**
     * Non-secret configuration only — a shortcode, a sender name, a region.
     * Anything credential-shaped is a `secret:` reference.
     */
    config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    secrets: z.record(z.string(), SecretRef).optional(),
    enabled: z.boolean().default(true),
  })
  .strict()
  .superRefine((i, ctx) => {
    // The check that makes the rule real rather than documented.
    for (const [name, value] of Object.entries(i.config ?? {})) {
      if (typeof value === "string" && /^[A-Za-z0-9_-]{24,}$/.test(value)) {
        ctx.addIssue({
          code: "custom",
          message:
            `config.${name} looks like a credential. Secrets never live in the spec — ` +
            `move it to \`secrets\` as \`secret:NAME\` and set the value in the environment.`,
        });
      }
    }
  });

export const Wiring = z.array(Integration);
export type Integration = z.infer<typeof Integration>;
