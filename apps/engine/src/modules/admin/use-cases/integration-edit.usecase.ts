/**
 * Declaring an integration (ADR 0034).
 *
 * The shape `TypeEditUseCase` and `AutomationEditUseCase` have: every edit
 * produces a whole spec and goes through `ApplySpecUseCase`, so an integration
 * declared in a browser lands in the same history, with the same diff and the
 * same undo, as one written in YAML.
 *
 * The rule this file exists to keep: **a credential never arrives here.** What
 * a form posts for a secret is the name of an environment variable, and what
 * lands in the spec is `secret:NAME` (ADR 0001). There is no code path from
 * this screen to a value.
 */
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";
import { SiteSpec, type Integration } from "@forinda-cms/spec";

import { INTEGRATION_KIND_INFO, settingsFor, type Setting } from "@/shared/integrations";
import { ApplySpecUseCase } from "./apply-spec.usecase";

export interface EditInput {
  readonly actor: string;
  readonly allowDestructive?: boolean;
}

export type EditResult = { ok: true; seq: number } | { ok: false; error: string };

/** What the form posts: plain settings by name, and secrets as variable names. */
export interface IntegrationSettingsInput {
  readonly label?: string | undefined;
  readonly enabled: boolean;
  readonly config: Readonly<Record<string, string>>;
  readonly secrets: Readonly<Record<string, string>>;
}

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

@Service({ scope: Lifetime.REQUEST })
export class IntegrationEditUseCase {
  constructor(@Inject(ApplySpecUseCase) private readonly applySpec: ApplySpecUseCase) {}

  /**
   * A new integration, with the defaults its kind declares.
   *
   * Added filled in rather than blank, for the reason a step is: the applied
   * spec has to be valid, and "add it, then configure it" cannot be two
   * applies. A required setting with no default is left empty deliberately —
   * a shortcode nobody has cannot be invented, and an empty one is refused at
   * the save that tries to use it rather than guessed at here.
   */
  create(spec: SiteSpec, key: string, kind: string, label: string, input: EditInput) {
    return this.edit(spec, input, (wiring) => {
      if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(key)) return "Use lowercase words joined by -.";
      if (wiring.some((i) => i.key === key)) return `There is already one called "${key}".`;

      const info = INTEGRATION_KIND_INFO[kind];
      if (!info) return `"${kind}" is not a kind of integration.`;
      if (info.unimplemented) return `Nothing here can talk to ${info.label} yet.`;

      const config: Record<string, string | number | boolean> = {};
      for (const setting of info.config ?? []) {
        if (setting.default !== undefined) config[setting.name] = setting.default;
      }

      wiring.push({
        key,
        kind: kind as Integration["kind"],
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(Object.keys(config).length > 0 ? { config } : {}),
        enabled: true,
      } as Integration);
      return null;
    });
  }

  update(spec: SiteSpec, key: string, settings: IntegrationSettingsInput, input: EditInput) {
    return this.edit(spec, input, (wiring) => {
      const integration = wiring.find((i) => i.key === key);
      if (!integration) return "That integration no longer exists.";

      const info = INTEGRATION_KIND_INFO[integration.kind];
      if (!info) return `"${integration.kind}" is not a kind of integration.`;

      // Which settings apply depends on what was just posted, not on what is
      // stored: choosing a different vendor and filling its fields is one save.
      const applicable = settingsFor(info, settings.config);

      // A setting is only *required* if the form that was submitted had a
      // control for it. Choosing a different vendor reveals that vendor's
      // fields — refusing the change because they are empty would make the
      // change unreachable, since the only screen that offers them is the one
      // after it. What is missing is said on that screen instead.
      const offered = new Set(
        settingsFor(info, integration.config ?? {}).config.map((s) => s.name),
      );
      const offeredSecrets = new Set(
        settingsFor(info, integration.config ?? {}).secrets.map((s) => s.name),
      );

      const config: Record<string, string | number | boolean> = {};
      for (const setting of applicable.config) {
        const raw = (settings.config[setting.name] ?? "").trim();
        if (setting.kind === "boolean") {
          if (raw === "on") config[setting.name] = true;
          continue;
        }
        if (raw === "") {
          if (setting.required && offered.has(setting.name)) {
            return `${info.label} needs ${lower(setting.label)}.`;
          }
          continue;
        }
        if (setting.kind === "number") {
          const value = Number(raw);
          if (Number.isNaN(value)) return `${setting.label} has to be a number.`;
          config[setting.name] = value;
          continue;
        }
        config[setting.name] = raw;
      }

      const secrets: Record<string, string> = {};
      for (const setting of applicable.secrets) {
        const name = (settings.secrets[setting.name] ?? "").trim();
        if (name === "") {
          if (setting.required && offeredSecrets.has(setting.name)) {
            return `${info.label} needs ${lower(setting.label)}.`;
          }
          continue;
        }
        // The one check that keeps a credential out of the spec: this field
        // takes the NAME of an environment variable. A pasted key does not
        // look like one, and is refused rather than committed to history.
        if (!ENV_NAME.test(name)) {
          return `${setting.label} takes the name of an environment variable — capitals and underscores, like MPESA_PASSKEY. Never the value itself.`;
        }
        secrets[setting.name] = `secret:${name}`;
      }

      const next = integration as Integration & Record<string, unknown>;
      if (settings.label?.trim()) next["label"] = settings.label.trim();
      else delete next["label"];
      next["enabled"] = settings.enabled;

      if (Object.keys(config).length > 0) next["config"] = config;
      else delete next["config"];
      if (Object.keys(secrets).length > 0) next["secrets"] = secrets;
      else delete next["secrets"];

      return null;
    });
  }

  /**
   * Removing one.
   *
   * Refused while something still points at it: an automation step naming a
   * webhook that is gone is a run that fails at the moment it matters, and the
   * reference check would refuse the spec anyway — with a message about a path
   * rather than about the thing being deleted.
   */
  /** What names this integration, in the owner's words. For the screen. */
  usedBy(spec: SiteSpec, key: string): string[] {
    return usedBy(spec, key);
  }

  remove(spec: SiteSpec, key: string, input: EditInput) {
    return this.edit(spec, input, (wiring) => {
      const at = wiring.findIndex((i) => i.key === key);
      if (at < 0) return "That integration no longer exists.";

      const used = usedBy(spec, key);
      if (used.length > 0) {
        return `${used.join(" and ")} still ${used.length === 1 ? "uses" : "use"} "${key}". Change ${used.length === 1 ? "it" : "them"} first.`;
      }

      wiring.splice(at, 1);
      return null;
    });
  }

  private async edit(
    spec: SiteSpec,
    input: EditInput,
    mutate: (wiring: Integration[]) => string | null,
  ): Promise<EditResult> {
    const draft = structuredClone(spec) as SiteSpec & { wiring: Integration[] };
    const refusal = mutate(draft.wiring);
    if (refusal) return { ok: false, error: refusal };

    const validated = SiteSpec.safeParse(draft);
    if (!validated.success) {
      return {
        ok: false,
        error: validated.error.issues[0]?.message ?? "That change is not valid.",
      };
    }

    try {
      const { seq } = await this.applySpec.execute(validated.data, {
        actor: input.actor,
        source: "integrations",
        allowDestructive: input.allowDestructive === true,
      });
      return { ok: true, seq };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/**
 * The declared settings this integration still has nothing for.
 *
 * An integration can be saved half-finished on purpose — switching vendors
 * reveals the new vendor's fields — so something has to say so out loud, or it
 * is the "looks configured, does nothing" failure with a nicer form on top.
 */
export function missingFrom(
  integration: Integration,
  applicable: { config: readonly Setting[]; secrets: readonly Setting[] },
): string[] {
  const missing: string[] = [];
  for (const setting of applicable.config) {
    // A setting with a default is never missing: the form shows that value and
    // the next save writes it.
    if (setting.default !== undefined) continue;
    if (setting.required && integration.config?.[setting.name] === undefined) {
      missing.push(lower(setting.label));
    }
  }
  for (const setting of applicable.secrets) {
    if (setting.required && integration.secrets?.[setting.name] === undefined) {
      missing.push(lower(setting.label));
    }
  }
  return missing;
}

/** What names this integration — said in the owner's words, not as paths. */
function usedBy(spec: SiteSpec, key: string): string[] {
  const used: string[] = [];
  for (const type of spec.content) {
    if (type.payment?.via === key) used.push(`${type.label} takes payment through it`);
  }
  for (const workflow of spec.logic) {
    const named = workflow.steps.some((s) => Object.values(s.params ?? {}).some((v) => v === key));
    if (named) used.push(`the "${workflow.key}" automation sends to it`);
  }
  return used;
}

/**
 * A label mid-sentence: "needs a shortcode", not "needs a Shortcode".
 *
 * Only where the word is ordinary capitalisation. "API key" lowercased blindly
 * reads "aPI key", which is worse than leaving it alone.
 */
const lower = (label: string): string =>
  /^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
