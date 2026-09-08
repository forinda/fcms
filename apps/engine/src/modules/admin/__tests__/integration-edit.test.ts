/**
 * Declaring an integration (ADR 0034).
 *
 * The rule worth a test above all others: a credential cannot get into the
 * spec through this screen. The rest is the same surgery the other builders
 * have — what an edit does, what it refuses, and that a refusal changes
 * nothing.
 */
import { describe, expect, it } from "vitest";
import { SiteSpec } from "@forinda-cms/spec";

import { INTEGRATION_KIND_INFO, settingsFor } from "@/shared/integrations";
import { ApplySpecUseCase } from "../use-cases/apply-spec.usecase";
import { IntegrationEditUseCase, missingFrom } from "../use-cases/integration-edit.usecase";

const spec = SiteSpec.parse({
  specVersion: 2,
  name: "Riverside Salon",
  theme: { colors: { brand: "#1a7f5a" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
  wiring: [
    {
      key: "chat",
      kind: "webhook",
      label: "Salon chat",
      config: { url: "https://chat.example/hook" },
    },
    { key: "notify", kind: "sms", label: "Customer texts", config: { provider: "preview" } },
  ],
  content: [
    {
      key: "booking",
      label: "Booking",
      fields: [{ name: "reference", label: "Reference", type: "text" }],
    },
  ],
  pages: [],
  logic: [
    {
      key: "tell-the-owner",
      trigger: { on: "entry.created", type: "booking" },
      steps: [{ action: "webhook.post", params: { to: "chat" } }],
    },
  ],
});

function editor() {
  const applied: SiteSpec[] = [];
  const apply = Object.assign(Object.create(ApplySpecUseCase.prototype) as ApplySpecUseCase, {
    execute: async (next: SiteSpec) => {
      applied.push(next);
      return { seq: applied.length, changes: [], migration: [] };
    },
  });
  return { edits: new IntegrationEditUseCase(apply), applied };
}

const INPUT = { actor: "owner@example.test", role: "owner" as const };
const found = (s: SiteSpec, key: string) => s.wiring.find((i) => i.key === key)!;

const settings = (over: Record<string, string> = {}, secrets: Record<string, string> = {}) => ({
  label: "Customer texts",
  enabled: true,
  config: { provider: "africastalking", username: "riverside", ...over },
  secrets,
});

describe("credentials", () => {
  it("refuses a value where a variable name belongs", async () => {
    const { edits, applied } = editor();
    const result = await edits.update(
      spec,
      "notify",
      settings({}, { apiKey: "atsk_9f3c1d0e7b2a4c8d" }),
      INPUT,
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("name of an environment variable");
    // The important half: nothing was applied, so the key is not in the spec,
    // not in a patch, and not in history.
    expect(applied).toHaveLength(0);
  });

  it("stores a reference, never a value", async () => {
    const { edits, applied } = editor();
    expect(
      await edits.update(spec, "notify", settings({}, { apiKey: "AT_API_KEY" }), INPUT),
    ).toEqual({ ok: true, seq: 1 });
    expect(found(applied[0]!, "notify").secrets).toEqual({ apiKey: "secret:AT_API_KEY" });
  });
});

describe("settings", () => {
  it("only insists on what the form it came from could ask for", async () => {
    const { edits, applied } = editor();
    // Switching vendor reveals that vendor's fields. Refusing the switch
    // because they are empty would make the switch unreachable.
    expect(
      await edits.update(
        spec,
        "notify",
        { ...settings(), config: { provider: "africastalking" } },
        INPUT,
      ),
    ).toEqual({ ok: true, seq: 1 });

    const after = found(applied[0]!, "notify");
    const applicable = settingsFor(INTEGRATION_KIND_INFO["sms"]!, after.config ?? {});
    // …and what is missing is then something the screen can say out loud.
    expect(missingFrom(after, applicable)).toEqual(["username", "API key"]);
  });

  it("insists once the field was on the form", async () => {
    const { edits, applied } = editor();
    await edits.update(
      spec,
      "notify",
      { ...settings(), config: { provider: "africastalking" } },
      INPUT,
    );

    const result = await edits.update(
      applied[0]!,
      "notify",
      { ...settings(), config: { provider: "africastalking", username: "" } },
      INPUT,
    );
    expect(result).toEqual({ ok: false, error: "SMS needs username." });
  });

  it("drops a setting that belongs to a vendor no longer chosen", async () => {
    const { edits, applied } = editor();
    await edits.update(spec, "notify", settings({}, { apiKey: "AT_API_KEY" }), INPUT);
    await edits.update(
      applied[0]!,
      "notify",
      { label: "Customer texts", enabled: true, config: { provider: "preview" }, secrets: {} },
      INPUT,
    );

    const after = found(applied[1]!, "notify");
    expect(after.config).toEqual({ provider: "preview" });
    expect(after.secrets).toBeUndefined();
  });

  it("turns one off without deleting it", async () => {
    const { edits, applied } = editor();
    await edits.update(
      spec,
      "chat",
      {
        label: "Salon chat",
        enabled: false,
        config: { url: "https://chat.example/hook" },
        secrets: {},
      },
      INPUT,
    );
    expect(found(applied[0]!, "chat").enabled).toBe(false);
  });
});

describe("declaring one", () => {
  it("arrives with the defaults its kind declares", async () => {
    const { edits, applied } = editor();
    expect(await edits.create(spec, "till", "payment.mpesa", "M-Pesa", INPUT)).toEqual({
      ok: true,
      seq: 1,
    });
    expect(found(applied[0]!, "till").config).toEqual({ environment: "sandbox" });
  });

  it("refuses a kind nothing implements", async () => {
    const { edits, applied } = editor();
    expect(await edits.create(spec, "diary", "calendar", "Diary", INPUT)).toEqual({
      ok: false,
      error: "Nothing here can talk to Calendar yet.",
    });
    expect(applied).toHaveLength(0);
  });

  it("refuses a key already taken", async () => {
    const { edits } = editor();
    expect(await edits.create(spec, "chat", "webhook", "Another", INPUT)).toEqual({
      ok: false,
      error: 'There is already one called "chat".',
    });
  });
});

describe("removing one", () => {
  it("refuses while something still names it", async () => {
    const { edits, applied } = editor();
    const result = await edits.remove(spec, "chat", INPUT);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain(
      '"tell-the-owner" automation sends to it',
    );
    expect(applied).toHaveLength(0);
  });

  it("goes when nothing does", async () => {
    const { edits, applied } = editor();
    expect(await edits.remove(spec, "notify", INPUT)).toEqual({ ok: true, seq: 1 });
    expect(applied[0]!.wiring.map((i) => i.key)).toEqual(["chat"]);
  });
});

describe("what each kind declares", () => {
  it("offers every vendor the registry has, and preview under both", () => {
    const sms = INTEGRATION_KIND_INFO["sms"]!;
    const provider = sms.config?.find((s) => s.name === "provider");
    expect(provider?.options?.map((o) => o.value)).toEqual(["preview", "africastalking"]);

    const email = INTEGRATION_KIND_INFO["email"]!;
    expect(email.config?.find((s) => s.name === "provider")?.options?.map((o) => o.value)).toEqual([
      "preview",
      "resend",
    ]);
  });

  it("says which kinds have nothing behind them yet", () => {
    expect(INTEGRATION_KIND_INFO["calendar"]?.unimplemented).toBe(true);
    expect(INTEGRATION_KIND_INFO["payment.mpesa"]?.unimplemented).toBeUndefined();
  });
});
