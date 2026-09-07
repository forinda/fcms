/**
 * M-Pesa STK Push, with the network stubbed (ADR 0023 §6).
 *
 * These pin the request shape Daraja documents and the decisions this file
 * makes on top of it — what a result code means, what happens when the amount
 * has cents in it, and what an unreachable provider does to a booking that has
 * already been written.
 *
 * They are **not** evidence that it works against the live API. That needs a
 * shortcode and a passkey, and until someone runs it the provider says so in
 * the admin and on the payment page.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { msisdn, mpesaProvider } from "../mpesa.provider";
import type { ChargeRequest } from "../provider";

const request: ChargeRequest = {
  amount: 150000,
  currency: "KES",
  payerRef: "0712345678",
  description: "Deposit",
  config: { shortcode: "174379", environment: "sandbox" },
  secrets: { consumerKey: "key", consumerSecret: "secret", passkey: "passkey" },
  callbackUrl: "https://salon.example/pay/callback/payment.mpesa",
};

/** Answers the OAuth call, then each queued response in order. */
function stubFetch(...responses: unknown[]) {
  const calls: { url: string; body: unknown }[] = [];
  const queue = [{ access_token: "token", expires_in: "3599" }, ...responses];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      return { ok: true, json: async () => queue.shift() };
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("phone numbers", () => {
  it("accepts the three ways a Kenyan number is written", () => {
    expect(msisdn("0712345678")).toBe("254712345678");
    expect(msisdn("+254 712 345 678")).toBe("254712345678");
    expect(msisdn("254712345678")).toBe("254712345678");
    expect(msisdn("712345678")).toBe("254712345678");
  });

  it("refuses anything else rather than guessing", () => {
    // A wrong number here sends a payment prompt to a stranger.
    expect(msisdn("0812345678")).toBeNull();
    expect(msisdn("07123456")).toBeNull();
    expect(msisdn("not a phone")).toBeNull();
  });
});

describe("starting a charge", () => {
  it("sends the documented STK push and keeps the checkout id", async () => {
    const calls = stubFetch({
      ResponseCode: "0",
      CheckoutRequestID: "ws_CO_1",
      MerchantRequestID: "m1",
    });

    const result = await mpesaProvider.charge(request);

    expect(result).toMatchObject({ status: "pending", reference: "ws_CO_1" });
    const push = calls[1]!;
    expect(push.url).toContain("/mpesa/stkpush/v1/processrequest");
    expect(push.body).toMatchObject({
      BusinessShortCode: "174379",
      TransactionType: "CustomerPayBillOnline",
      // Whole shillings, not minor units — Daraja takes the major unit.
      Amount: 1500,
      PartyA: "254712345678",
      PhoneNumber: "254712345678",
      CallBackURL: request.callbackUrl,
    });
  });

  it("uses buy-goods for a till", async () => {
    const calls = stubFetch({ ResponseCode: "0", CheckoutRequestID: "ws_CO_2" });
    await mpesaProvider.charge({ ...request, config: { ...request.config, till: true } });

    expect(calls[1]!.body).toMatchObject({ TransactionType: "CustomerBuyGoodsOnline" });
  });

  it("refuses a price with cents rather than rounding somebody's money", async () => {
    const result = await mpesaProvider.charge({ ...request, amount: 149999 });
    expect(result.status).toBe("failed");
    expect(result.instruction).toMatch(/whole shillings/);
  });

  it("refuses a number that is not an M-Pesa one before calling anything", async () => {
    const calls = stubFetch();
    const result = await mpesaProvider.charge({ ...request, payerRef: "0812345678" });

    expect(result.status).toBe("failed");
    expect(calls).toHaveLength(0);
  });

  it("says what Daraja said when it will not start", async () => {
    stubFetch({ ResponseCode: "1", errorMessage: "Invalid Access Token" });
    const result = await mpesaProvider.charge(request);

    expect(result).toMatchObject({ status: "failed", instruction: "Invalid Access Token" });
  });

  it("leaves the payment pending when the provider is unreachable", async () => {
    // The booking is already written. An API that did not answer is not
    // evidence that the customer did not pay, and must not fail the row.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const result = await mpesaProvider.charge(request);

    expect(result.status).toBe("pending");
    expect(result.instruction).toMatch(/did not answer/);
  });

  it("refuses to guess when the credentials are missing", async () => {
    const result = await mpesaProvider.charge({ ...request, secrets: {} });
    expect(result).toMatchObject({ status: "pending" });
    expect(result.instruction).toMatch(/shortcode or passkey|consumer key/);
  });
});

describe("confirming", () => {
  const confirm = (answer: unknown) => {
    stubFetch(answer);
    const { payerRef: _p, callbackUrl: _c, ...rest } = request;
    return mpesaProvider.confirm!("ws_CO_1", rest);
  };

  it("reads success", async () => {
    expect(await confirm({ ResultCode: "0", ResultDesc: "Accepted" })).toMatchObject({
      status: "paid",
    });
  });

  it("reads the codes that mean no money moved", async () => {
    expect((await confirm({ ResultCode: "1032" })).status).toBe("failed"); // cancelled
    expect((await confirm({ ResultCode: "1" })).status).toBe("failed"); // no funds
    expect((await confirm({ ResultCode: "1037" })).status).toBe("failed"); // no answer
  });

  it("stays pending on a code nobody has seen before", async () => {
    // Reading an unknown code as failure would tell a customer their payment
    // did not happen while their phone says it did.
    expect((await confirm({ ResultCode: "9999" })).status).toBe("pending");
  });

  it("stays pending when the query itself fails", async () => {
    expect((await confirm({ errorMessage: "Server error" })).status).toBe("pending");
  });
});
