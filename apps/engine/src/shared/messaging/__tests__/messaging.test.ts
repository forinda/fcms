/**
 * Sending a message (ADR 0032).
 *
 * The provider shapes are pinned against their documented APIs with the network
 * stubbed. They have **not** been run against a real account, which is the same
 * position ADR 0023 took for M-Pesa and for the same reason — so what these
 * prove is the request this platform would make, not that a message arrives.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { MESSAGE_PROVIDERS, providerFor, type Message } from "../index";

const base: Message = {
  to: "+254712345678",
  body: "Your appointment on Tuesday is confirmed.",
  config: {},
  secrets: {},
};

afterEach(() => vi.unstubAllGlobals());

function stub(response: unknown, ok = true) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok, status: ok ? 200 : 400, json: async () => response };
    }),
  );
  return calls;
}

describe("choosing a provider", () => {
  it("delivers nothing unless an integration names a vendor", () => {
    // The safe direction: a misconfigured integration writes the message down
    // instead of sending it somewhere nobody meant.
    expect(providerFor({})).toBe(MESSAGE_PROVIDERS["preview"]);
    expect(providerFor({ provider: "nonsense" })).toBe(MESSAGE_PROVIDERS["preview"]);
    expect(providerFor({ provider: "africastalking" })).toBe(MESSAGE_PROVIDERS["africastalking"]);
  });
});

describe("the provider that needs no account", () => {
  it("writes the message down and says it was not delivered", async () => {
    const calls = stub({});
    const sent = await MESSAGE_PROVIDERS["preview"]!.send(base);

    expect(sent.preview).toBe(true);
    expect(sent.note).toContain("not delivered (preview)");
    expect(sent.note).toContain("+254712345678");
    // Not a mock of a vendor: no invented message id, and nothing sent.
    expect(sent.reference).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("keeps enough of the body to debug with, and not more", async () => {
    const sent = await MESSAGE_PROVIDERS["preview"]!.send({ ...base, body: "x".repeat(300) });
    expect(sent.note).toContain("…");
    expect(sent.note.length).toBeLessThan(200);
  });
});

describe("Africa's Talking", () => {
  const provider = MESSAGE_PROVIDERS["africastalking"]!;
  const configured: Message = {
    ...base,
    config: { sender: "RIVERSIDE" },
    secrets: { username: "riverside", apiKey: "key" },
  };

  it("sends the documented form, with the key in a header rather than the body", async () => {
    const calls = stub({
      SMSMessageData: { Recipients: [{ status: "Success", messageId: "ATX1" }] },
    });
    const sent = await provider.send(configured);

    expect(calls[0]!.url).toContain("/version1/messaging");
    expect((calls[0]!.init.headers as Record<string, string>)["apiKey"]).toBe("key");
    const body = String(calls[0]!.init.body);
    expect(body).toContain("to=%2B254712345678");
    expect(body).toContain("from=RIVERSIDE");
    // The credential is a header; it must not travel in the payload.
    expect(body).not.toContain("key");
    expect(sent.reference).toBe("ATX1");
  });

  it("uses the sandbox host when the integration says so", async () => {
    const calls = stub({ SMSMessageData: { Recipients: [{ status: "Success" }] } });
    await provider.send({ ...configured, config: { environment: "sandbox" } });

    expect(calls[0]!.url).toContain("api.sandbox.africastalking.com");
  });

  it("fails the step when the vendor did not accept it", async () => {
    // A message that silently did not arrive is the failure this must not have.
    stub({ SMSMessageData: { Recipients: [{ status: "InsufficientBalance" }] } });
    await expect(provider.send(configured)).rejects.toThrow(/InsufficientBalance/);
  });

  it("refuses to try without credentials", async () => {
    const calls = stub({});
    await expect(provider.send({ ...configured, secrets: {} })).rejects.toThrow(/username or key/);
    expect(calls).toHaveLength(0);
  });

  it("says it has never been run against the real thing", () => {
    expect(provider.unverified).toBe(true);
  });
});

describe("email", () => {
  const provider = MESSAGE_PROVIDERS["resend"]!;
  const configured: Message = {
    ...base,
    to: "guest@example.test",
    subject: "Your booking",
    config: { from: "salon@example.test" },
    secrets: { apiKey: "key" },
  };

  it("sends the documented JSON, with the key as a bearer token", async () => {
    const calls = stub({ id: "msg_1" });
    const sent = await provider.send(configured);

    expect((calls[0]!.init.headers as Record<string, string>)["authorization"]).toBe("Bearer key");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      from: "salon@example.test",
      to: ["guest@example.test"],
      subject: "Your booking",
    });
    expect(sent.reference).toBe("msg_1");
  });

  it("reports what the vendor said when it refuses", async () => {
    stub({ message: "from address is not verified" }, false);
    await expect(provider.send(configured)).rejects.toThrow(/not verified/);
  });

  it("refuses to try without a sender or a key", async () => {
    await expect(provider.send({ ...configured, config: {} })).rejects.toThrow(/key or sender/);
  });
});
