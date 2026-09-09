/**
 * Where a visitor is in a journey (ADR 0028).
 *
 * The state is a row and the visitor holds an opaque token. What this owns is
 * the three things that make the journey safe: the token is hashed, a choice is
 * checked against the rows the step actually offers, and the selections a
 * submission uses are read from here rather than from the request.
 */
import { createHash, randomBytes } from "node:crypto";
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";
import { and, eq, lt } from "drizzle-orm";
import { flowSessions, type FlowSessionRow } from "@forinda-cms/db";
import type { Db, Scope } from "@forinda-cms/db";
import type { Page, SiteSpec } from "@forinda-cms/spec";

import { DB } from "@/shared/db";
import { CURRENT_SCOPE } from "@/contributors/site.contributor";

export const FLOW_COOKIE = "fcms_flow";

/** An abandoned booking journey is not something anyone returns to. */
const LIFETIME_MS = 24 * 60 * 60 * 1000;

export type Flow = NonNullable<Page["flows"]>[number];

@Service({ scope: Lifetime.REQUEST })
export class FlowUseCase {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CURRENT_SCOPE) private readonly scope: Scope,
  ) {}

  /** A fresh token for a visitor who has none. */
  static mint(): string {
    return randomBytes(32).toString("hex");
  }

  /**
   * The fields a flow's selections fill (ADR 0028 §3).
   *
   * A selection binds to the field of its own name. Read from the state row
   * rather than from the request: a hidden input carrying the chosen stylist is
   * a hidden input a caller can change.
   */
  static fieldsFrom(
    spec: SiteSpec,
    flow: Flow,
    typeKey: string,
    answers: Record<string, Record<string, unknown>>,
  ): Record<string, unknown> {
    const type = spec.content.find((t) => t.key === typeKey);
    if (!type) return {};

    const out: Record<string, unknown> = {};
    for (const step of flow.steps) {
      const selects = step.selects;
      const chosen = answers[step.key];
      if (!selects || !chosen) continue;

      const field = type.fields.find((f) => f.name === selects.as);
      if (!field) continue;

      const id = String(chosen["slug"] ?? chosen["id"] ?? "");
      // A reference names the type the *field* declares, not the type the step
      // read from. A step choosing from a derived type — the free rooms for
      // these dates — wrote `ref:vacancy/…` into a field declared `to: room`,
      // which is a reference to a type that holds no rows. It resolved anyway,
      // because matching compares the slug, and would stop the day a derived
      // row's slug differed from the row it was derived from.
      out[selects.as] =
        field.type === "reference" ? `ref:${field.to}/${id}` : (chosen["startsAt"] ?? id);
    }
    return out;
  }

  /** Hashed, like every other token this project stores. */
  private hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private expiry(): Date {
    return new Date(Date.now() + LIFETIME_MS);
  }

  async find(
    token: string | undefined,
    pageKey: string,
    flowKey: string,
  ): Promise<FlowSessionRow | null> {
    if (!token) return null;
    const [row] = await this.db
      .select()
      .from(flowSessions)
      .where(
        and(
          eq(flowSessions.siteId, this.scope.siteId),
          eq(flowSessions.tokenHash, this.hash(token)),
          eq(flowSessions.pageKey, pageKey),
          eq(flowSessions.flowKey, flowKey),
        ),
      )
      .limit(1);

    // Expired is the same as absent, and it is swept on the next write rather
    // than by a job nobody runs.
    return row && row.expiresAt.getTime() > Date.now() ? row : null;
  }

  /** What has been chosen, for the renderer's scope. */
  async answers(
    token: string | undefined,
    pageKey: string,
    flowKey: string,
  ): Promise<Record<string, Record<string, unknown>>> {
    return (await this.find(token, pageKey, flowKey))?.answers ?? {};
  }

  /** Record a choice. */
  async choose(
    token: string,
    page: Page,
    flow: Flow,
    stepKey: string,
    chosen: Record<string, unknown>,
  ): Promise<FlowSessionRow> {
    await this.sweep();

    const existing = await this.find(token, page.key, flow.key);
    const answers = { ...existing?.answers, [stepKey]: chosen };

    if (existing) {
      const [row] = await this.db
        .update(flowSessions)
        .set({ answers, updatedAt: new Date(), expiresAt: this.expiry() })
        .where(eq(flowSessions.id, existing.id))
        .returning();
      return row!;
    }

    const [row] = await this.db
      .insert(flowSessions)
      .values({
        siteId: this.scope.siteId,
        orgId: this.scope.orgId,
        pageKey: page.key,
        flowKey: flow.key,
        tokenHash: this.hash(token),
        answers,
        expiresAt: this.expiry(),
      })
      .returning();
    return row!;
  }

  /**
   * Undo one step, so "Change" means change rather than start again.
   *
   * Everything that depended on it goes too: a stylist chosen for a service
   * nobody picked any more is an answer to a question that no longer exists.
   */
  async forget(token: string, page: Page, flow: Flow, stepKey: string): Promise<void> {
    const existing = await this.find(token, page.key, flow.key);
    if (!existing) return;

    const dropped = new Set([stepKey]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const step of flow.steps) {
        if (dropped.has(step.key)) continue;
        if ((step.requires ?? []).some((need) => dropped.has(need))) {
          dropped.add(step.key);
          changed = true;
        }
      }
    }

    const answers = Object.fromEntries(
      Object.entries(existing.answers).filter(([key]) => !dropped.has(key)),
    );
    await this.db
      .update(flowSessions)
      .set({ answers, updatedAt: new Date() })
      .where(eq(flowSessions.id, existing.id));
  }

  /** A completed journey deletes its own state. */
  async finish(token: string | undefined, pageKey: string, flowKey: string): Promise<void> {
    if (!token) return;
    await this.db
      .delete(flowSessions)
      .where(
        and(
          eq(flowSessions.siteId, this.scope.siteId),
          eq(flowSessions.tokenHash, this.hash(token)),
          eq(flowSessions.pageKey, pageKey),
          eq(flowSessions.flowKey, flowKey),
        ),
      );
  }

  /** Rows nobody will use, removed when somebody starts a journey. */
  private async sweep(): Promise<void> {
    await this.db.delete(flowSessions).where(lt(flowSessions.expiresAt, new Date()));
  }
}
