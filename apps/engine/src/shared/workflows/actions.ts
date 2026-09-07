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

import { runScript, timeoutOf } from "./sandbox";

export interface ActionContext {
  /**
   * What earlier steps produced, and the trigger's own values.
   *
   * The scope a parameter's `{{ … }}` resolves against (ADR 0029 §3) — the
   * renderer's evaluator, with the renderer's ceiling.
   */
  readonly values?: Record<string, unknown>;
  /**
   * A test run: report what a step *would* do and touch nothing (ADR 0029 §5).
   *
   * Refused rather than mocked. A mock invents a response, the rest of the
   * pipeline runs on the invention, and the preview reports success for a
   * fiction.
   */
  readonly dryRun?: boolean;
  readonly spec: SiteSpec;
  /** The entry the trigger was about. Absent for a scheduled run. */
  readonly entry?: EntryRow | undefined;
  readonly type?: ContentType | undefined;
  readonly params: Readonly<Record<string, unknown>>;
  /** Writing an entry goes through the same use-case every other write does. */
  readonly setState: (entryId: string, field: string, to: string) => Promise<void>;
}

/**
 * What a step did, and what it produced.
 *
 * The note is the line an owner reads on the run; the value is what
 * `steps.<key>` gives a later step (ADR 0029 §2).
 */
export interface ActionResult {
  readonly note: string;
  readonly value?: unknown;
}

/**
 * One thing a step needs, declared (ADR 0030 §2).
 *
 * The runner reads this to know what a step takes; the builder's panel reads
 * the same list to know what to ask for. One source, two consumers — a
 * hand-written form per action is the drift ADR 0004 guards against, one layer
 * down, and it goes stale the first time somebody adds an action without
 * opening the view.
 */
export interface ActionParam {
  readonly name: string;
  readonly label: string;
  /**
   * What kind of value, so the panel can offer the right choices rather than a
   * text box that accepts a webhook that does not exist.
   *
   *   - `integration` — one of this site's declared integrations, of `of` kind
   *   - `state`       — one of the watched type's declared states
   *   - `template`    — the weak template language, with a hint
   *   - `text`        — a plain string
   */
  readonly kind: "integration" | "state" | "template" | "text";
  /** For `integration`: which kind of integration may be chosen. */
  readonly of?: string;
  readonly required?: boolean;
  /**
   * What a new step starts with, where an empty string is not a legal value.
   *
   * A required `text` parameter cannot be prefilled by choosing from a set —
   * there is no set — so the action says what a working starting point looks
   * like. Without it, adding a script step is refused for having no script.
   */
  readonly default?: string;
  readonly help?: string;
}

export interface Action {
  /** One line, shown in the palette and given to the AI. */
  readonly summary: string;
  readonly params: readonly ActionParam[];
  run(ctx: ActionContext): Promise<ActionResult>;
}

/** What a step produced, for `steps.<key>` and for the run history. */
export interface ActionOutput {
  readonly note: string;
  readonly value?: unknown;
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
  summary: "Move an entry along a status it already declares.",
  params: [
    {
      name: "to",
      label: "Move to",
      kind: "state",
      required: true,
      help: "Only a state the type declares, along a transition it allows.",
    },
  ],
  async run({ entry, type, params, setState, dryRun }): Promise<ActionResult> {
    if (!entry || !type) return { note: "skipped: nothing to move" };

    const to = String(params["to"] ?? "");
    const field = type.fields.find((f) => f.type === "state");
    if (!field) throw new Error(`"${type.key}" has no state field`);
    if (!("values" in field) || !field.values.includes(to)) {
      throw new Error(`"${type.key}" has no state "${to}"`);
    }

    const from = String((entry.data as Record<string, unknown>)[field.name] ?? "");
    if (from === to) return { note: `already ${to}` };

    // The declared transitions are the whole point of a `state` field: a
    // workflow that could jump anywhere would make them decoration.
    const allowed = (field.transitions ?? []).some(
      (rule) => rule.from === from && rule.to.includes(to),
    );
    if (!allowed) throw new Error(`"${type.key}" cannot go from ${from || "nothing"} to ${to}`);

    if (dryRun) return { note: `would have moved from ${from} to ${to}` };

    await setState(entry.id, field.name, to);
    return { note: `moved from ${from} to ${to}`, value: { from, to } };
  },
};

const webhookPost: Action = {
  summary: "Post the entry to somewhere you have declared.",
  params: [
    {
      name: "to",
      label: "Send to",
      kind: "integration",
      of: "webhook",
      required: true,
      help: "The address lives on the integration, so a step cannot invent one.",
    },
  ],
  async run({ spec, entry, type, params, dryRun }): Promise<ActionResult> {
    const integration = spec.wiring.find((i) => i.key === String(params["to"] ?? ""));
    if (!integration || integration.kind !== "webhook") {
      throw new Error(`no webhook called "${String(params["to"])}"`);
    }
    if (integration.enabled === false) return { note: "skipped: that webhook is turned off" };

    const url = String(integration.config?.["url"] ?? "");
    if (!reachable(url)) throw new Error(`"${integration.key}" has no address this may post to`);

    if (dryRun) return { note: `would have posted to ${integration.key}` };

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
    return {
      note: `posted to ${integration.key} (${response.status})`,
      value: { status: response.status },
    };
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

/**
 * Call a declared service and keep what it answered (ADR 0029 §4).
 *
 * The base URL belongs to the integration; the step names a path. So the set of
 * hosts this site talks to is the set an owner declared, visible in the diff,
 * and a step cannot add one.
 */
const httpRequest: Action = {
  summary: "Call a service you have declared, and keep what it answered.",
  params: [
    { name: "to", label: "Service", kind: "integration", of: "api", required: true },
    {
      name: "path",
      label: "Path",
      kind: "template",
      required: true,
      help: "Joined to the service's base URL — `/customers/{{ entry.email }}`.",
    },
    { name: "method", label: "Method", kind: "text", help: "GET unless you say otherwise." },
    {
      name: "body",
      label: "Body",
      kind: "template",
      help: "Sent as-is. Give the step a key to read the answer later.",
    },
  ],
  async run({ spec, params, dryRun }): Promise<ActionResult> {
    const integration = spec.wiring.find((i) => i.key === String(params["to"] ?? ""));
    if (!integration || integration.kind !== "api") {
      throw new Error(`no api called "${String(params["to"])}"`);
    }
    if (integration.enabled === false) return { note: "skipped: that service is turned off" };

    const base = String(integration.config?.["url"] ?? "").replace(/\/$/, "");
    const path = String(params["path"] ?? "");
    const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
    if (!reachable(url)) throw new Error(`"${integration.key}" has no address this may call`);

    const method = String(params["method"] ?? "GET").toUpperCase();
    if (dryRun) {
      // Reported, not performed: nothing leaves the building on a test run.
      return { note: `would have called ${method} ${url}` };
    }

    const response = await fetch(url, {
      method,
      headers: {
        accept: "application/json",
        ...(params["body"] === undefined ? {} : { "content-type": "application/json" }),
        ...secretHeaders(integration),
      },
      ...(params["body"] === undefined ? {} : { body: String(params["body"]) }),
      signal: AbortSignal.timeout(10_000),
    });

    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON: kept as text, because a step that needed the body still has
      // it and one that did not is unaffected.
    }

    if (!response.ok) {
      throw new Error(`${integration.key} answered ${response.status}`);
    }
    return {
      note: `called ${method} ${url} (${response.status})`,
      value: { status: response.status, body },
    };
  },
};

/**
 * The escape hatch (ADR 0031).
 *
 * It sees its input and returns a value. No network, no filesystem, no
 * database, no secrets — absent rather than declared-and-enforced, which is the
 * pipeline's own shape used as a security property: if a script needs data an
 * earlier step fetched it, and if something must be sent a later step sends it.
 */
const scriptRun: Action = {
  summary: "Work something out in JavaScript, with nothing but the values you pass it.",
  params: [
    {
      name: "code",
      label: "Script",
      kind: "text",
      required: true,
      default: "return input;",
      help: "`input` holds the entry and every named step. Return the value this step produces.",
    },
    {
      name: "timeoutMs",
      label: "Timeout (ms)",
      kind: "text",
      help: "2000 by default, 10000 at most.",
    },
  ],
  async run({ params, values }): Promise<ActionResult> {
    const code = String(params["code"] ?? "");
    if (!code.trim()) throw new Error("this step has no script");

    // A script touches nothing, so a test run executes it for real rather than
    // reporting what it would do (ADR 0031 §4).
    const result = await runScript(code, values ?? {}, timeoutOf(params["timeoutMs"]));
    if (result.error) throw new Error(result.error);

    const logged = result.logs?.length ? ` (${result.logs.length} logged)` : "";
    return { note: `ran the script${logged}`, value: result.value };
  },
};

export const ACTION_REGISTRY: Record<string, Action> = {
  "entry.transition": transition,
  "webhook.post": webhookPost,
  "http.request": httpRequest,
  "script.run": scriptRun,
};
