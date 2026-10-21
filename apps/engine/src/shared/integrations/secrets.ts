/**
 * `secret:NAME`, resolved — here and nowhere else (ADR 0001).
 *
 * A spec names a secret; the value lives in the environment and never reaches
 * a spec, a patch, a run record, a log or a model.
 *
 * Only `FCMS_SECRET_<NAME>` is reachable. `secret:NAME` used to read *any*
 * variable, so a manager could put `secret:DATABASE_URL` in a webhook header
 * and point the webhook at a URL they own — the server's own settings were one
 * spec edit from leaving. A prefix makes "what an integration may see" a set
 * the operator chose by naming it, rather than everything the process has.
 */
import type { Integration } from "@forinda-cms/spec";

export const SECRET_PREFIX = "FCMS_SECRET_";

/** The variable `secret:NAME` reads: `FCMS_SECRET_NAME`. */
export const secretVariable = (ref: string): string => SECRET_PREFIX + ref.replace(/^secret:/, "");

/**
 * Every secret an integration names, by the name it gave it.
 *
 * One that is not set is left out, and reported once per variable: after an
 * upgrade an install still has `MPESA_CONSUMER_KEY` set where it now needs
 * `FCMS_SECRET_MPESA_CONSUMER_KEY`, and a payment that silently stops
 * authenticating is worse than a line saying which variable to set.
 */
export function secretsOf(integration: Integration): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, ref] of Object.entries(integration.secrets ?? {})) {
    const variable = secretVariable(ref);
    const value = process.env[variable];
    if (value) out[name] = value;
    else warnOnce(variable, integration.key);
  }
  return out;
}

const warned = new Set<string>();
function warnOnce(variable: string, integration: string): void {
  if (warned.has(variable)) return;
  warned.add(variable);
  console.warn(`[secrets] ${integration} names a secret, but ${variable} is not set.`);
}
