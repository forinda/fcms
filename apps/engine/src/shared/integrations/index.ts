/**
 * What each kind of integration needs, declared once (ADR 0034).
 *
 * `wiring` says a site talks to M-Pesa or Africa's Talking; what M-Pesa needs
 * to hear was known only to the provider that reads it — `config["shortcode"]`,
 * `secrets["passkey"]`, spelled out nowhere. So an owner could not fill one in
 * without reading the source, and a screen for it would have been a second,
 * hand-maintained copy of those strings.
 *
 * The declaration lives beside the implementation that reads it, and this file
 * composes them: payment kinds from `PROVIDERS`, `sms` and `email` from
 * `MESSAGE_PROVIDERS`, and the two kinds the workflow runner reads itself. One
 * source, two consumers — the same rule the block inspector and the automation
 * builder already follow.
 */
import { INTEGRATION_KINDS } from "@forinda-cms/spec";

import { MESSAGE_PROVIDERS } from "@/shared/messaging";
import { PROVIDERS } from "@/shared/payments";

/** One thing an integration needs, and enough about it to render a control. */
export interface Setting {
  readonly name: string;
  readonly label: string;
  readonly kind: "text" | "number" | "boolean" | "choice";
  /** For `choice`. The first is what a new integration gets. */
  readonly options?: readonly { value: string; label: string }[];
  readonly required?: boolean;
  readonly default?: string | number | boolean;
  readonly help?: string;
  /**
   * Only meaningful when another setting has this value.
   *
   * `sms` is one kind with two vendors behind it, so "Africa's Talking
   * username" is a real setting that is simply irrelevant when the provider is
   * `preview`. Saying which it belongs to is better than a screen that asks for
   * everything and better than one that hides what it will not explain.
   */
  readonly when?: { readonly setting: string; readonly is: string };
}

export interface IntegrationSettings {
  /** Plain settings — a shortcode, a sender name, a base URL. */
  readonly config?: readonly Setting[];
  /**
   * Credentials, by **environment variable name**.
   *
   * The value never appears here, in the spec, in a patch or on a screen. What
   * an owner types is the name of the variable holding it (ADR 0001).
   */
  readonly secrets?: readonly Setting[];
}

export interface IntegrationKindInfo extends IntegrationSettings {
  readonly kind: string;
  readonly label: string;
  readonly summary: string;
  /** True where nothing behind this kind is implemented yet. */
  readonly unimplemented?: boolean;
  /** True where the implementation has never run against the real vendor. */
  readonly unverified?: boolean;
}

const AUTHORIZATION: Setting = {
  name: "authorization",
  label: "Authorization",
  kind: "text",
  help: "Optional. The name of an environment variable; its value is sent as an Authorization header.",
};

/**
 * The kinds the workflow runner reads for itself.
 *
 * Both are `config.url` because both are one address — a webhook is somewhere
 * to post to, an api is something a step names a path under.
 */
const RUNNER_KINDS: Record<string, IntegrationKindInfo> = {
  webhook: {
    kind: "webhook",
    label: "Webhook",
    summary: "Somewhere to post to — another system, an automation tool, a chat room.",
    config: [
      {
        name: "url",
        label: "Address",
        kind: "text",
        required: true,
        help: "The full https:// address. A private or local address is refused.",
      },
    ],
    secrets: [AUTHORIZATION],
  },
  api: {
    kind: "api",
    label: "Service",
    summary: "A service this site calls, and keeps what it answered.",
    config: [
      {
        name: "url",
        label: "Base address",
        kind: "text",
        required: true,
        help: "A step names a path under this — so the set of hosts this site talks to is the set you declared here.",
      },
    ],
    secrets: [AUTHORIZATION],
  },
};

/** Kinds with nothing behind them yet, said plainly rather than offered. */
const NOT_YET: Record<string, { label: string; summary: string }> = {
  "payment.card": { label: "Cards", summary: "Card payments." },
  calendar: { label: "Calendar", summary: "Putting bookings in a calendar." },
  storage: { label: "Storage", summary: "Keeping uploaded files somewhere else." },
  analytics: { label: "Analytics", summary: "Counting visits." },
};

const PAYMENT_LABELS: Record<string, string> = {
  "payment.mpesa": "M-Pesa",
  "payment.manual": "Pay on arrival",
};

const MESSAGE_LABELS: Record<string, { label: string; summary: string }> = {
  sms: { label: "SMS", summary: "Text messages, sent by an automation." },
  email: { label: "Email", summary: "Email, sent by an automation." },
};

/**
 * `sms` and `email` are one kind with several vendors behind them.
 *
 * So the kind declares the choice, and each vendor's own settings are marked as
 * belonging to it. Adding a vendor is still one file: its settings appear here
 * because it is in the registry, not because this list was updated.
 */
function messageKind(kind: "sms" | "email"): IntegrationKindInfo {
  // `preview` is declared once, as an sms provider, but it delivers nothing —
  // which it does equally well for email. It is offered under both kinds
  // because "send it nowhere yet" is the honest starting point for either.
  const vendors = Object.entries(MESSAGE_PROVIDERS).filter(
    ([name, p]) => name === "preview" || p.kind === kind,
  );
  const provider: Setting = {
    name: "provider",
    label: "Sent by",
    kind: "choice",
    required: true,
    options: vendors.map(([name]) => ({ value: name, label: vendorLabel(name) })),
    default: "preview",
    help: "“Preview” writes the message down and delivers nothing — useful before you have an account.",
  };

  const owned = (settings: readonly Setting[] | undefined, name: string): Setting[] =>
    (settings ?? []).map((s) => ({
      ...s,
      when: { setting: "provider", is: name },
      help: s.help ?? `Used by ${vendorLabel(name)}.`,
    }));

  return {
    kind,
    label: MESSAGE_LABELS[kind]!.label,
    summary: MESSAGE_LABELS[kind]!.summary,
    unverified: vendors.some(([, p]) => p.unverified),
    config: [provider, ...vendors.flatMap(([name, p]) => owned(p.settings?.config, name))],
    secrets: vendors.flatMap(([name, p]) => owned(p.settings?.secrets, name)),
  };
}

const vendorLabel = (name: string): string =>
  name === "preview"
    ? "Preview — delivers nothing"
    : name === "africastalking"
      ? "Africa's Talking"
      : name.charAt(0).toUpperCase() + name.slice(1);

function paymentKind(kind: string): IntegrationKindInfo {
  const provider = PROVIDERS[kind]!;
  return {
    kind,
    label: PAYMENT_LABELS[kind] ?? kind,
    summary:
      kind === "payment.manual"
        ? "Payment arranged directly — on arrival, by transfer, in cash. Needs no account."
        : "Charges a customer through a real account.",
    ...(provider.unverified === true ? { unverified: true } : {}),
    config: provider.settings?.config ?? [],
    secrets: provider.settings?.secrets ?? [],
  };
}

/**
 * Every kind the spec allows, in the order they are offered.
 *
 * Built from the registries rather than listed, so a kind the spec allows and
 * nothing implements says so instead of quietly rendering an empty form.
 */
export const INTEGRATION_KIND_INFO: Record<string, IntegrationKindInfo> = Object.fromEntries(
  INTEGRATION_KINDS.map((kind) => {
    if (PROVIDERS[kind]) return [kind, paymentKind(kind)];
    if (kind === "sms" || kind === "email") return [kind, messageKind(kind)];
    if (RUNNER_KINDS[kind]) return [kind, RUNNER_KINDS[kind]];
    const missing = NOT_YET[kind] ?? { label: kind, summary: "" };
    return [
      kind,
      { kind, label: missing.label, summary: missing.summary, unimplemented: true },
    ] as const;
  }),
);

/** The settings that apply given what is already filled in. */
export function settingsFor(
  info: IntegrationKindInfo,
  config: Readonly<Record<string, unknown>>,
): { config: Setting[]; secrets: Setting[] } {
  const applies = (s: Setting) => !s.when || String(config[s.when.setting] ?? "") === s.when.is;
  return {
    config: (info.config ?? []).filter(applies),
    secrets: (info.secrets ?? []).filter(applies),
  };
}
