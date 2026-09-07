/**
 * `@forinda-cms/ai` — the planner.
 *
 * One prompt, one parser, two consumers: the assistant in the admin and the
 * eval harness that measures it (ADR 0018 §3). Keeping them together is the
 * whole point — a harness with its own copy of the prompt reports a number for
 * software nobody ships.
 *
 * Nothing here writes. `propose` returns a candidate spec or a refusal, and a
 * person decides (ADR 0018 §1).
 */
import { parseSpec, printSpec } from "@forinda-cms/lang";
import type { SiteSpec } from "@forinda-cms/spec";

import { SYSTEM, buildUserMessage, declined, extractYaml } from "./prompt.js";
import type { Provider } from "./provider.js";

export * from "./prompt.js";
export * from "./provider.js";

export type Proposal =
  /** The model produced a spec that parses and validates. */
  | { readonly kind: "spec"; readonly spec: SiteSpec; readonly yaml: string }
  /**
   * The model said the request cannot be expressed.
   *
   * An answer, not an error (ADR 0018 §4): doc 04 scores an honest refusal as
   * correct, and a UI that renders it as failure teaches owners to rephrase
   * until the model invents something.
   */
  | { readonly kind: "declined"; readonly reason: string }
  /** It produced something, and the something is not a valid spec. */
  | { readonly kind: "invalid"; readonly detail: string; readonly response: string };

export interface ProposeOptions {
  readonly provider: Provider;
  readonly spec: SiteSpec;
  readonly instruction: string;
  /** Identifies the exchange for recording; the harness passes its task id. */
  readonly id?: string;
}

/**
 * Ask for a change, get a candidate.
 *
 * The whole spec goes out and the whole spec comes back — ADR 0018 §2, for the
 * reasons ADR 0015 §2 gives: one diff engine, one classification, and no stale
 * index to corrupt a page with.
 */
export async function propose(options: ProposeOptions): Promise<Proposal> {
  const { provider, spec, instruction } = options;

  const currentYaml = printSpec(spec);
  const response = await provider.complete(
    SYSTEM,
    buildUserMessage(currentYaml, instruction),
    options.id ?? "assist",
  );

  const yaml = extractYaml(response);

  // Refusal is checked against the absence of YAML rather than before it: a
  // model that explains its reluctance *and* produces the spec anyway has done
  // the work, and rejecting that would punish thoroughness.
  if (!yaml) {
    return declined(response)
      ? { kind: "declined", reason: refusalText(response) }
      : { kind: "invalid", detail: "The reply contained no specification.", response };
  }

  const parsed = parseSpec(yaml);
  if (!parsed.ok) {
    const first = parsed.diagnostics[0];
    return {
      kind: "invalid",
      detail: first
        ? `${first.message}${first.line ? ` (line ${first.line})` : ""}`
        : "The specification did not parse.",
      response,
    };
  }

  return { kind: "spec", spec: parsed.spec as SiteSpec, yaml };
}

/** The explanation, without the sentinel the owner should never see. */
function refusalText(response: string): string {
  const text = response.replace(/CANNOT_EXPRESS/g, "").trim();
  return text === "" ? "That cannot be expressed in a site specification." : text;
}
