/**
 * Payments, as rows.
 *
 * Scoped like everything else, and deliberately thin: what a payment is allowed
 * to do to itself lives in the use-case, because the rules there are about money
 * rather than about SQL (ADR 0023 §4).
 */
import { Inject, Repository, Scope as Lifetime } from "@forinda/kickjs";
import { and, desc, eq } from "drizzle-orm";

import { payments, type NewPaymentRow, type PaymentRow } from "@forinda-cms/db";
import type { Db, Scope } from "@forinda-cms/db";

import { DB } from "@/shared/db";
import { CURRENT_SCOPE } from "@/contributors/site.contributor";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Repository({ scope: Lifetime.REQUEST })
export class PaymentRepository {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CURRENT_SCOPE) private readonly scope: Scope,
  ) {}

  private get scoped() {
    return and(eq(payments.orgId, this.scope.orgId), eq(payments.siteId, this.scope.siteId));
  }

  async create(row: Omit<NewPaymentRow, "siteId" | "orgId">): Promise<PaymentRow> {
    const [created] = await this.db
      .insert(payments)
      .values({ ...row, siteId: this.scope.siteId, orgId: this.scope.orgId })
      .returning();
    return created!;
  }

  async byId(id: string): Promise<PaymentRow | null> {
    // A payment id comes out of a URL a stranger controls, and a malformed one
    // reaching a uuid column is a 500 rather than a 404.
    if (!UUID.test(id)) return null;
    const [row] = await this.db
      .select()
      .from(payments)
      .where(and(this.scoped, eq(payments.id, id)))
      .limit(1);
    return row ?? null;
  }

  /**
   * By the provider's own id for the charge.
   *
   * Unscoped by site on purpose: a callback arrives with nothing but this, on a
   * request that has no session and no site of its own. The reference is the
   * provider's, so it identifies exactly one row.
   */
  async byReference(provider: string, reference: string): Promise<PaymentRow | null> {
    const [row] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.provider, provider), eq(payments.reference, reference)))
      .limit(1);
    return row ?? null;
  }

  async update(id: string, patch: Partial<NewPaymentRow>): Promise<PaymentRow | null> {
    const [row] = await this.db
      .update(payments)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(payments.id, id))
      .returning();
    return row ?? null;
  }

  /** Every payment for one entry, newest first — what the admin shows. */
  async forEntry(entryId: string): Promise<PaymentRow[]> {
    if (!UUID.test(entryId)) return [];
    return this.db
      .select()
      .from(payments)
      .where(and(this.scoped, eq(payments.entryId, entryId)))
      .orderBy(desc(payments.createdAt));
  }
}
