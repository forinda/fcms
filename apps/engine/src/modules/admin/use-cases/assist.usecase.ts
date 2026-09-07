/**
 * The assistant (ADR 0018).
 *
 * Ask for a change in words, get a candidate spec and the diff it would make.
 * Nothing here writes: §1 makes applying a person's decision, and the diff it
 * returns is the same one the CLI prints and the canvas obeys.
 *
 * The model is optional. With no key this reports that and every other surface
 * carries on, which is ADR 0011 §3 as code — *"exhausting AI must never stop
 * them editing their site"*.
 */
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";
import { liveProvider, propose, type Proposal, type Provider } from "@forinda-cms/ai";
import type { SiteSpec, SpecChange } from "@forinda-cms/spec";

import { ApplySpecUseCase } from "./apply-spec.usecase";

export type Suggestion =
  | {
      readonly kind: "spec";
      readonly spec: SiteSpec;
      readonly yaml: string;
      readonly changes: readonly SpecChange[];
      readonly destructive: number;
      readonly initial: boolean;
    }
  | { readonly kind: "declined"; readonly reason: string }
  | { readonly kind: "invalid"; readonly detail: string }
  | { readonly kind: "unavailable"; readonly reason: string };

@Service({ scope: Lifetime.REQUEST })
export class AssistUseCase {
  constructor(@Inject(ApplySpecUseCase) private readonly applySpec: ApplySpecUseCase) {}

  /** True when this install can call a model at all. */
  get available(): boolean {
    return Boolean(process.env["ANTHROPIC_API_KEY"]);
  }

  /**
   * A candidate change, described.
   *
   * The proposal is planned before it is shown, so the owner reads what would
   * happen rather than YAML — and the destructive count comes from the same
   * classifier that will refuse it, rather than a second opinion about what is
   * risky.
   */
  async suggest(spec: SiteSpec, instruction: string, provider?: Provider): Promise<Suggestion> {
    const model = provider ?? (this.available ? liveProvider() : undefined);
    if (!model) {
      return {
        kind: "unavailable",
        reason:
          "This install has no ANTHROPIC_API_KEY, so the assistant is off. Everything else works.",
      };
    }

    const proposal = await this.attempt(model, spec, instruction);
    if (proposal.kind !== "spec") return proposal;

    const plan = await this.applySpec.plan(proposal.spec);
    return {
      kind: "spec",
      spec: proposal.spec,
      yaml: proposal.yaml,
      changes: plan.changes,
      destructive: plan.destructive.length,
      initial: plan.initial,
    };
  }

  /**
   * The model call, with its failures turned into answers.
   *
   * A provider throws for a bad key, a rate limit or a network fault — none of
   * which is a 500 the owner should see. Each is a sentence about what to do.
   */
  private async attempt(
    provider: Provider,
    spec: SiteSpec,
    instruction: string,
  ): Promise<Proposal | { kind: "unavailable"; reason: string }> {
    try {
      return await propose({ provider, spec, instruction });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { kind: "unavailable", reason: `The model could not be reached: ${message}` };
    }
  }
}
