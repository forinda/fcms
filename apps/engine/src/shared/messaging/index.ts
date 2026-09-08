/**
 * Sending a message (ADR 0032).
 *
 * The provider shape payments established, applied to email and SMS: the action
 * says what to send, the integration says who sends it, and swapping vendors is
 * a config change rather than a spec rewrite.
 *
 * `preview` is the one that needs no credentials — it writes the message down
 * and delivers nothing, in those words. Everything else here is implemented
 * against a documented API and **has never run against a real account**, which
 * is stated where an owner can see it rather than assumed away.
 */
import type { IntegrationSettings } from "@/shared/integrations";

export interface Message {
  readonly to: string;
  readonly body: string;
  /** Email only. */
  readonly subject?: string | undefined;
  readonly config: Readonly<Record<string, string | number | boolean>>;
  readonly secrets: Readonly<Record<string, string>>;
}

export interface Sent {
  /** One line for the run history, in the owner's words. */
  readonly note: string;
  /** The vendor's id for this message, where it gives one. */
  readonly reference?: string | undefined;
  /** True when nothing was actually delivered. */
  readonly preview?: boolean;
}

export interface MessageProvider {
  readonly kind: "sms" | "email";
  /** True where this has never been run against the vendor's real API. */
  readonly unverified?: boolean;
  /**
   * What this vendor needs, declared beside the code that reads it.
   *
   * The admin's integration form is generated from it (ADR 0034) — an
   * undeclared `config["username"]` is a setting nobody can find.
   */
  readonly settings?: IntegrationSettings;
  send(message: Message): Promise<Sent>;
}

/** What a message looks like on a run: enough to debug, nothing to leak. */
function summarise(message: Message): string {
  const body = message.body.length > 120 ? `${message.body.slice(0, 120)}…` : message.body;
  return `${message.to}: ${body}`;
}

/**
 * Writes it down and sends nothing.
 *
 * Not a mock of a vendor — it invents no message id and no delivery receipt.
 * It is the provider that needs no account, so the whole path exists and can be
 * read before a business has one (ADR 0032 §2).
 */
const preview: MessageProvider = {
  kind: "sms",
  async send(message: Message): Promise<Sent> {
    return { note: `not delivered (preview) — ${summarise(message)}`, preview: true };
  },
};

/**
 * Africa's Talking, first because doc 14 is about which rails the first
 * customers are on rather than which are best known.
 *
 * **Unverified**: implemented against the documented form-encoded API, tested
 * with the network stubbed, never run against a real account.
 */
const africastalking: MessageProvider = {
  kind: "sms",
  unverified: true,

  settings: {
    config: [
      { name: "username", label: "Username", kind: "text", required: true },
      {
        name: "environment",
        label: "Which account",
        kind: "choice",
        default: "production",
        options: [
          { value: "production", label: "Live" },
          { value: "sandbox", label: "Sandbox — test messages" },
        ],
      },
      {
        name: "sender",
        label: "Sender name",
        kind: "text",
        help: "Optional. The short name messages appear from, once yours is approved.",
      },
    ],
    secrets: [{ name: "apiKey", label: "API key", kind: "text", required: true }],
  },
  async send(message: Message): Promise<Sent> {
    const username = message.secrets["username"] ?? String(message.config["username"] ?? "");
    const apiKey = message.secrets["apiKey"];
    if (!username || !apiKey) throw new Error("this SMS account is missing its username or key");

    const host =
      message.config["environment"] === "sandbox"
        ? "https://api.sandbox.africastalking.com"
        : "https://api.africastalking.com";

    const form = new URLSearchParams({
      username,
      to: message.to,
      message: message.body,
      ...(message.config["sender"] ? { from: String(message.config["sender"]) } : {}),
    });

    const response = await fetch(`${host}/version1/messaging`, {
      method: "POST",
      headers: {
        apiKey,
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      signal: AbortSignal.timeout(10_000),
    });

    const body = (await response.json().catch(() => ({}))) as {
      SMSMessageData?: { Recipients?: { status?: string; messageId?: string }[] };
    };
    const recipient = body.SMSMessageData?.Recipients?.[0];

    // "Success" is the vendor's word for accepted, and anything else is a
    // failure the run should show rather than a message nobody received.
    if (!response.ok || recipient?.status !== "Success") {
      throw new Error(`the SMS was not accepted (${recipient?.status ?? response.status})`);
    }
    return { note: `sent to ${message.to}`, reference: recipient.messageId };
  },
};

/**
 * Email over a JSON API rather than SMTP.
 *
 * SMTP would mean a client library, a connection pool and TLS negotiation in
 * the runner; a vendor's HTTP API is a `fetch`. **Unverified**, as above.
 */
const resend: MessageProvider = {
  kind: "email",
  unverified: true,

  settings: {
    config: [
      {
        name: "from",
        label: "Sent from",
        kind: "text",
        required: true,
        help: "An address on a domain you have verified — “Riverside Salon <hello@riverside.co.ke>”.",
      },
    ],
    secrets: [{ name: "apiKey", label: "API key", kind: "text", required: true }],
  },
  async send(message: Message): Promise<Sent> {
    const apiKey = message.secrets["apiKey"];
    const from = String(message.config["from"] ?? "");
    if (!apiKey || !from) throw new Error("this email account is missing its key or sender");

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject ?? "",
        text: message.body,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!response.ok)
      throw new Error(body.message ?? `the email was not accepted (${response.status})`);

    return { note: `sent to ${message.to}`, reference: body.id };
  },
};

export const MESSAGE_PROVIDERS: Record<string, MessageProvider> = {
  preview,
  africastalking,
  resend,
};

/**
 * The provider an integration names, or the one that delivers nothing.
 *
 * Defaulting to `preview` rather than to a vendor is the safe direction: a
 * misconfigured integration writes the message down instead of sending it
 * somewhere nobody meant.
 */
export function providerFor(config: Readonly<Record<string, unknown>>): MessageProvider {
  const named = String(config["provider"] ?? "preview");
  return MESSAGE_PROVIDERS[named] ?? preview;
}
