/**
 * M-Pesa STK Push, over Daraja.
 *
 * First rather than cards, because doc 14 is right about which rail the first
 * customers are on: a Nairobi salon taking a deposit needs mobile money, and
 * ~25% of all M-Pesa transactions already flow through this API.
 *
 * **Unverified against the live API** (ADR 0023 §6). The shapes below are the
 * documented ones and the tests exercise them with the network stubbed, but no
 * shilling has moved through this file — it needs a shortcode and a passkey the
 * repository does not have. Anything that presents it to an owner says so.
 */
import type { ChargeRequest, ChargeResult, PaymentProvider, PaymentStatus } from "./provider";

const HOSTS = {
  sandbox: "https://sandbox.safaricom.co.ke",
  production: "https://api.safaricom.co.ke",
} as const;

/** `yyyyMMddHHmmss` in Nairobi time, which is what Daraja hashes. */
function timestamp(now: Date): string {
  const at = new Date(now.getTime() + 3 * 60 * 60 * 1000); // UTC+3, no DST in Kenya.
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}`
  );
}

/**
 * `0712…`, `+254712…`, `254712…` all mean one number, and Daraja accepts one form.
 *
 * Returns null rather than guessing: a wrong number here sends someone else a
 * payment prompt.
 */
export function msisdn(input: string): string | null {
  const digits = input.replace(/[^0-9]/g, "");
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}

class MpesaError extends Error {}

async function token(request: ChargeRequest): Promise<string> {
  const host = HOSTS[request.config["environment"] === "production" ? "production" : "sandbox"];
  const key = request.secrets["consumerKey"];
  const secret = request.secrets["consumerSecret"];
  if (!key || !secret) throw new MpesaError("M-Pesa is missing its consumer key or secret.");

  const response = await fetch(`${host}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}` },
  });
  const body = (await response.json()) as { access_token?: string };
  if (!response.ok || !body.access_token) throw new MpesaError("M-Pesa refused our credentials.");
  return body.access_token;
}

function credentials(request: ChargeRequest, now: Date) {
  const shortcode = String(request.config["shortcode"] ?? "");
  const passkey = request.secrets["passkey"];
  if (!shortcode || !passkey) throw new MpesaError("M-Pesa is missing its shortcode or passkey.");

  const stamp = timestamp(now);
  return {
    shortcode,
    stamp,
    password: Buffer.from(`${shortcode}${passkey}${stamp}`).toString("base64"),
  };
}

/**
 * What a result code means, in this platform's vocabulary.
 *
 * Everything that is not success or a known "no money moved" case stays
 * `pending`: a code nobody has seen before must not be read as a failed payment
 * when the customer's phone says otherwise.
 */
function statusOf(code: string): PaymentStatus {
  if (code === "0") return "paid";
  // 1032 cancelled by user, 1 insufficient funds, 1037 no response from the
  // phone, 2001 wrong PIN, 1019 transaction expired.
  if (["1", "1019", "1032", "1037", "2001"].includes(code)) return "failed";
  return "pending";
}

export const mpesaProvider: PaymentProvider = {
  kind: "payment.mpesa",
  unverified: true,
  needsPayerRef: true,

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    const phone = request.payerRef ? msisdn(request.payerRef) : null;
    if (!phone) return { status: "failed", instruction: "That phone number is not an M-Pesa one." };

    // Daraja takes whole shillings. Rounding somebody's money quietly is worse
    // than refusing, so a price with cents in it is a configuration error.
    if (request.amount % 100 !== 0) {
      return {
        status: "failed",
        instruction: "M-Pesa takes whole shillings, and this price has cents in it.",
      };
    }

    try {
      const now = new Date();
      const { shortcode, stamp, password } = credentials(request, now);
      const host = HOSTS[request.config["environment"] === "production" ? "production" : "sandbox"];
      const access = await token(request);

      const response = await fetch(`${host}/mpesa/stkpush/v1/processrequest`, {
        method: "POST",
        headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
        body: JSON.stringify({
          BusinessShortCode: shortcode,
          Password: password,
          Timestamp: stamp,
          TransactionType:
            request.config["till"] === true ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
          Amount: request.amount / 100,
          PartyA: phone,
          PartyB: shortcode,
          PhoneNumber: phone,
          CallBackURL: request.callbackUrl,
          AccountReference: String(request.config["reference"] ?? "Payment").slice(0, 12),
          TransactionDesc: request.description.slice(0, 13),
        }),
      });

      const body = (await response.json()) as {
        CheckoutRequestID?: string;
        ResponseCode?: string;
        errorMessage?: string;
      };

      if (!response.ok || body.ResponseCode !== "0" || !body.CheckoutRequestID) {
        return {
          status: "failed",
          instruction: body.errorMessage ?? "M-Pesa would not start that payment.",
          detail: { errorMessage: body.errorMessage },
        };
      }

      return {
        status: "pending",
        reference: body.CheckoutRequestID,
        instruction: "Check your phone and enter your M-Pesa PIN.",
      };
    } catch (error) {
      // A provider being unreachable must not lose the booking that was already
      // written — the payment stays pending and can be retried.
      return {
        status: "pending",
        instruction:
          error instanceof MpesaError
            ? error.message
            : "M-Pesa did not answer. Nothing has been charged yet.",
      };
    }
  },

  async confirm(reference, request) {
    const now = new Date();
    const { shortcode, stamp, password } = credentials(request as ChargeRequest, now);
    const host = HOSTS[request.config["environment"] === "production" ? "production" : "sandbox"];
    const access = await token(request as ChargeRequest);

    const response = await fetch(`${host}/mpesa/stkpushquery/v1/query`, {
      method: "POST",
      headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: stamp,
        CheckoutRequestID: reference,
      }),
    });

    const body = (await response.json()) as { ResultCode?: string; ResultDesc?: string };
    // A query that itself failed says nothing about the money: still pending.
    if (!response.ok || body.ResultCode === undefined) return { status: "pending" };

    return {
      status: statusOf(String(body.ResultCode)),
      detail: { resultCode: body.ResultCode, resultDesc: body.ResultDesc },
    };
  },
};
