/**
 * Payments (ADR 0023).
 *
 * Two properties carry the record and both are tested against a real database:
 * the amount comes from the entry rather than from anything a stranger sent,
 * and a payment that has been paid cannot be walked backwards by a callback.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  closeAllPools,
  createDb,
  entries,
  organizations,
  payments,
  sites,
  type PaymentRow,
} from "@forinda-cms/db";
import { SiteSpec, type ContentType } from "@forinda-cms/spec";

import { WorkflowUseCase } from "@/shared/workflows/workflow.usecase";
import { PaymentRepository } from "../payment.repository";
import { PaymentUseCase } from "../payment.usecase";

const url = process.env["DATABASE_URL"];
const suite = url ? describe : describe.skip;
const db = url ? createDb(url) : (undefined as never);

const ORG = "org_payments";
const SITE = "site_payments";
const scope = { orgId: ORG, siteId: SITE };

const spec = SiteSpec.parse({
  specVersion: 2,
  name: "Riverside Salon",
  theme: { colors: { brand: "#1a7f5a" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
  wiring: [
    { key: "counter", kind: "payment.manual", label: "Pay at the salon", config: {} },
    { key: "till", kind: "payment.mpesa", config: { shortcode: "174379" } },
  ],
  content: [
    {
      key: "booking",
      label: "Booking",
      submissions: "anyone",
      payment: { amount: { field: "deposit" }, currency: "KES", via: "counter" },
      fields: [
        { name: "name", label: "Name", type: "text" },
        { name: "deposit", label: "Deposit", type: "number" },
      ],
    },
  ],
  pages: [],
});

const type = spec.content[0] as ContentType;

suite("payments", () => {
  let use: PaymentUseCase;
  let repository: PaymentRepository;
  let entryId: string;

  beforeEach(async () => {
    await db.delete(payments);
    await db.delete(entries).where(eq(entries.siteId, SITE));
    await db.delete(sites).where(eq(sites.orgId, ORG));
    await db.delete(organizations).where(eq(organizations.id, ORG));

    await db.insert(organizations).values({ id: ORG, name: "Payments org" });
    await db.insert(sites).values({ id: SITE, orgId: ORG, slug: "salon", name: "Salon" });
    const [entry] = await db
      .insert(entries)
      .values({
        siteId: SITE,
        orgId: ORG,
        typeKey: "booking",
        data: { name: "Amina", deposit: 1500 },
        status: "draft",
      })
      .returning();
    entryId = entry!.id;

    repository = new PaymentRepository(db, scope);
    use = new PaymentUseCase(repository, new WorkflowUseCase(db, scope));
  });

  afterAll(async () => {
    if (url) await closeAllPools();
  });

  const record = (data: Record<string, unknown> = { deposit: 1500 }) =>
    use.record({ spec, type, entryId, data });

  describe("the amount", () => {
    it("comes from the entry, in minor units", async () => {
      const result = await record();
      expect(result.ok && result.payment.amount).toBe(150000);
      expect(result.ok && result.payment.currency).toBe("KES");
    });

    it("ignores anything the request says it should be", async () => {
      // The whole point. A form that posts an amount is a form that lets
      // somebody pay 1 for a 15,000 booking.
      const result = await use.record({
        spec,
        type,
        entryId,
        data: { deposit: 1500, amount: 1, price: 1 } as Record<string, unknown>,
      });
      expect(result.ok && result.payment.amount).toBe(150000);
    });

    it("refuses a row with no price rather than charging nothing", async () => {
      const result = await record({ deposit: "not a number" });
      expect(result).toEqual({
        ok: false,
        error: "That has no price on it, so it cannot be paid for.",
      });
    });

    it("takes a fixed price where the type names one", () => {
      const fixed = { ...type, payment: { ...type.payment!, amount: { fixed: 25000 } } };
      expect(PaymentUseCase.amountOf(fixed as ContentType, {})).toBe(25000);
    });

    it("rounds once, so a price with cents cannot drift", () => {
      expect(PaymentUseCase.amountOf(type, { deposit: 19.99 })).toBe(1999);
      expect(PaymentUseCase.amountOf(type, { deposit: 0.1 + 0.2 })).toBe(30);
    });
  });

  describe("what a payment may do next", () => {
    it("starts pending, and manual payments stay there until somebody says so", async () => {
      const result = await record();
      expect(result.ok && result.payment.status).toBe("pending");
      // No `instruction` in this integration's config, so the provider says the
      // safe generic thing rather than inventing terms the owner never agreed.
      expect(result.ok && result.instruction).toMatch(/take payment directly/);
    });

    it("settles when the owner confirms the cash arrived", async () => {
      const started = await record();
      const paid = await use.settleManually(
        (started as { payment: PaymentRow }).payment,
        "owner@example.test",
      );

      expect(paid.status).toBe("paid");
      expect(paid.paidAt).not.toBeNull();
      expect(paid.detail).toMatchObject({ confirmedBy: "owner@example.test" });
    });

    it("never walks a settled payment backwards", async () => {
      // A late `failed` callback for a payment already confirmed is a retry
      // arriving out of order, not a reversal.
      const started = await record();
      const paid = await use.settleManually(
        (started as { payment: PaymentRow }).payment,
        "owner@example.test",
      );

      const again = await use.confirm(spec, paid);
      expect(again.status).toBe("paid");
      expect(await use.settleManually(paid, "someone.else@example.test")).toMatchObject({
        status: "paid",
        detail: { confirmedBy: "owner@example.test" },
      });
    });
  });

  describe("scope", () => {
    it("does not hand one site's payment to another", async () => {
      const started = await record();
      const elsewhere = new PaymentRepository(db, { orgId: ORG, siteId: "site_someone_else" });

      expect(await elsewhere.byId((started as { payment: PaymentRow }).payment.id)).toBeNull();
    });

    it("says nothing for an id that is not even an id", async () => {
      // Straight out of a URL: a malformed one reaching a uuid column is a 500.
      expect(await repository.byId("../../etc/passwd")).toBeNull();
    });
  });

  describe("the manual provider is the one that needs nothing", () => {
    it("uses the instruction the owner wrote", async () => {
      const configured = SiteSpec.parse({
        ...spec,
        wiring: [
          {
            key: "counter",
            kind: "payment.manual",
            config: { instruction: "Pay the stylist when you arrive." },
          },
        ],
      });
      const result = await use.record({ spec: configured, type, entryId, data: { deposit: 10 } });
      expect(result.ok && result.instruction).toBe("Pay the stylist when you arrive.");
    });
  });
});
