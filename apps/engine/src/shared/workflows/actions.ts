/**
 * What a workflow step can actually do (ADR 0024 §4).
 *
 * A registry, keyed by the names `@forinda-cms/spec` publishes, so a step that
 * validates is a step that runs. Two actions to start with, and both were
 * chosen for the same reason: neither needs a credential, so neither can be
 * shipped as something that looks configured and silently does nothing.
 *
 * Email and SMS are absent on purpose. They need a provider behind them — the
 * shape payments established (ADR 0023 §5) — and an action that cannot run is
 * worse than an action that does not exist.
 */
import type { ContentType, Integration, SiteSpec } from "@forinda-cms/spec";
import type { EntryRow } from "@forinda-cms/db";

export interface ActionContext {
  readonly spec: SiteSpec;
  /** The entry the trigger was about. Absent for a scheduled run. */
  readonly entry?: EntryRow | undefined;
  readonly type?: ContentType | undefined;
  readonly params: Readonly<Record<string, unknown>>;
  /** Writing an entry goes through the same use-case every other write does. */
  readonly setState: (entryId: string, field: string, to: string) => Promise<void>;
}

/** One line for the run history — what this step did, in the owner's words. */
export type ActionResult = string;

export interface Action {
  run(ctx: ActionContext): Promise<ActionResult>;
}

/**
 * Where a workflow may post.
 *
 * A `webhook` integration is an owner's declared destination, and "declared"
 * does not make an address safe: loopback, the link-local metadata endpoint and
 * the private ranges are the standard server-side request forgery targets, and
 * on a self-hosted box the admin, the metadata service and the database all sit
 * on the other side of that line.
 *
 * **What this does not cover**: a public name that resolves to a private
 * address. Closing that needs resolution at request time and a check on the
 * socket, which Node's fetch does not expose. What limits it meanwhile is that
 * a destination is declared in `wiring`, appears in the diff, and cannot be
 * added by a step — so it is a change an owner approves rather than one an
 * automation makes.
 */
export function reachable(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  // IPv6: loopback, unique-local (fc00::/7) and link-local (fe80::/10).
  if (host === "::1" || /^f[cd]/.test(host) || host.startsWith("fe80:")) return false;

  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (octets) {
    const a = Number(octets[1]);
    const b = Number(octets[2]);
    // 0/8 this network, 10/8 private, 127/8 loopback, 169.254/16 link-local
    // (the cloud metadata endpoint), 172.16/12 private, 192.168/16 private,
    // 100.64/10 carrier-grade NAT.
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }

  return true;
}

const transition: Action = {
  async run({ entry, type, params, setState }): Promise<ActionResult> {
    if (!entry || !type) return "skipped: nothing to move";

    const to = String(params["to"] ?? "");
    const field = type.fields.find((f) => f.type === "state");
    if (!field) throw new Error(`"${type.key}" has no state field`);
    if (!("values" in field) || !field.values.includes(to)) {
      throw new Error(`"${type.key}" has no state "${to}"`);
    }

    const from = String((entry.data as Record<string, unknown>)[field.name] ?? "");
    if (from === to) return `already ${to}`;

    // The declared transitions are the whole point of a `state` field: a
    // workflow that could jump anywhere would make them decoration.
    const allowed = (field.transitions ?? []).some(
      (rule) => rule.from === from && rule.to.includes(to),
    );
    if (!allowed) throw new Error(`"${type.key}" cannot go from ${from || "nothing"} to ${to}`);

    await setState(entry.id, field.name, to);
    return `moved from ${from} to ${to}`;
  },
};

const webhookPost: Action = {
  async run({ spec, entry, type, params }): Promise<ActionResult> {
    const integration = spec.wiring.find((i) => i.key === String(params["to"] ?? ""));
    if (!integration || integration.kind !== "webhook") {
      throw new Error(`no webhook called "${String(params["to"])}"`);
    }
    if (integration.enabled === false) return "skipped: that webhook is turned off";

    const url = String(integration.config?.["url"] ?? "");
    if (!reachable(url)) throw new Error(`"${integration.key}" has no address this may post to`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...secretHeaders(integration),
      },
      body: JSON.stringify({
        site: spec.name,
        type: type?.key,
        entry: entry ? { id: entry.id, slug: entry.slug, ...entry.data } : null,
        at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    // A 500 from the far end is retried; a 400 is not going to become a 200 by
    // being sent again, so it fails the run once and stops.
    if (!response.ok && response.status >= 500) {
      throw new Error(`${integration.key} answered ${response.status}`);
    }
    return `posted to ${integration.key} (${response.status})`;
  },
};

/**
 * A webhook's own credential, sent as a header.
 *
 * `secret:NAME` resolved here and nowhere else, so the value never reaches a
 * spec, a patch, a run record or a model (ADR 0001).
 */
function secretHeaders(integration: Integration): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, ref] of Object.entries(integration.secrets ?? {})) {
    const value = process.env[ref.replace(/^secret:/, "")];
    if (value) headers[name] = value;
  }
  return headers;
}

export const ACTION_REGISTRY: Record<string, Action> = {
  "entry.transition": transition,
  "webhook.post": webhookPost,
};
