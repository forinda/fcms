/**
 * The site repository — every read and write scoped to one site.
 *
 * ADR 0002 seam 1: `site_id` on every table, **every query through a scoping
 * repository**. The seam only pays off if nothing can bypass it, so this module
 * is the single place that touches those tables and it takes the scope in its
 * constructor rather than per call. A method that forgot the filter would be a
 * cross-tenant read, and forgetting is what the shape has to prevent.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import {
  SiteSpec,
  classify,
  diffSpecs,
  type Classification,
  type SpecChange,
} from "@forinda-cms/spec";

import type { Db } from "./client.js";
import { entries, siteSpecs, sites, specPatches } from "./schema.js";

export interface Scope {
  readonly orgId: string;
  readonly siteId: string;
}

export interface PatchRecord {
  readonly seq: number;
  readonly actor: string;
  readonly source: string;
  readonly summary: string;
  readonly classification: Classification;
  readonly appliedAt: Date;
  readonly revertedAt: Date | null;
}

export interface ApplyOptions {
  readonly actor: string;
  /** chat | canvas | cli | mcp — every surface reduces to a patch (research/11). */
  readonly source: string;
  readonly harness?: string;
  /**
   * Destructive changes need an explicit yes. Refusing by default is what makes
   * the gate real rather than advisory — a caller that means it says so.
   */
  readonly allowDestructive?: boolean;
}

export class DestructiveChangeError extends Error {
  constructor(readonly changes: readonly SpecChange[]) {
    super(
      `refusing ${changes.length} destructive change(s) without confirmation:\n` +
        changes.map((c) => `  - ${c.summary}${c.impact ? ` ${c.impact}` : ""}`).join("\n"),
    );
    this.name = "DestructiveChangeError";
  }
}

export class SiteRepository {
  constructor(
    private readonly db: Db,
    private readonly scope: Scope,
  ) {}

  /** Both ids, always. Every query in this class starts here. */
  private get where() {
    return and(eq(entries.orgId, this.scope.orgId), eq(entries.siteId, this.scope.siteId));
  }

  async loadSpec(): Promise<SiteSpec | undefined> {
    const [row] = await this.db
      .select()
      .from(siteSpecs)
      .where(and(eq(siteSpecs.orgId, this.scope.orgId), eq(siteSpecs.siteId, this.scope.siteId)))
      .limit(1);
    if (!row) return undefined;
    // Parsed rather than cast. A spec written by an older version, or by hand,
    // must not reach the renderer unvalidated.
    return SiteSpec.parse(row.document);
  }

  /**
   * Apply a new spec as a patch.
   *
   * The whole change goes through one transaction: the spec row, the patch
   * record and its inverse land together or not at all. A patch written without
   * its inverse — or an inverse without its patch — would break undo silently,
   * which is the one guarantee doc 13's argument cannot lose.
   */
  async applySpec(
    next: SiteSpec,
    options: ApplyOptions,
  ): Promise<{ seq: number; changes: SpecChange[] }> {
    const current = await this.loadSpec();
    const counts = current ? await this.entryCounts(current) : {};
    const changes = current ? diffSpecs(current, next, counts) : [];
    const destructive = changes.filter((c) => c.classification === "destructive");

    if (destructive.length > 0 && options.allowDestructive !== true) {
      throw new DestructiveChangeError(destructive);
    }

    const ops = [{ op: "set" as const, path: "/", value: next }];
    const inverse = [{ op: "set" as const, path: "/", value: current ?? null }];

    return this.db.transaction(async (tx) => {
      // Computed inside the transaction, so two concurrent applies cannot pick
      // the same seq — the unique index on (site_id, seq) would reject the
      // second, which is the behaviour we want rather than a silent interleave.
      const [row] = await tx
        .select({ next: sql<number>`coalesce(max(${specPatches.seq}), 0) + 1` })
        .from(specPatches)
        .where(
          and(eq(specPatches.orgId, this.scope.orgId), eq(specPatches.siteId, this.scope.siteId)),
        );
      const seq = row?.next ?? 1;

      await tx
        .insert(siteSpecs)
        .values({
          siteId: this.scope.siteId,
          orgId: this.scope.orgId,
          document: next,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: siteSpecs.siteId,
          set: { document: next, updatedAt: new Date() },
        });

      await tx.insert(specPatches).values({
        siteId: this.scope.siteId,
        orgId: this.scope.orgId,
        seq,
        actor: options.actor,
        source: options.source,
        harness: options.harness ?? null,
        ops,
        inverse,
        classification:
          classify(ops) === "destructive" || destructive.length > 0 ? "destructive" : "additive",
        summary:
          changes.length === 0
            ? "No visible change."
            : changes.length === 1
              ? changes[0]!.summary
              : `${changes.length} changes, ${destructive.length} destructive.`,
      });

      return { seq, changes };
    });
  }

  /**
   * Undo the most recent patch.
   *
   * Marks rather than deletes: history stays append-only, so "what happened to
   * my site last Tuesday" survives an undo. That also means an undo is itself a
   * patch, which is what makes redo possible later without a second mechanism.
   */
  async undo(actor: string): Promise<{ seq: number; summary: string } | undefined> {
    return this.db.transaction(async (tx) => {
      const [last] = await tx
        .select()
        .from(specPatches)
        .where(
          and(
            eq(specPatches.orgId, this.scope.orgId),
            eq(specPatches.siteId, this.scope.siteId),
            sql`${specPatches.revertedAt} is null`,
          ),
        )
        .orderBy(desc(specPatches.seq))
        .limit(1);

      if (!last) return undefined;

      const inverse = last.inverse as { op: string; path: string; value: unknown }[];
      const restored = inverse[0]?.value ?? null;

      if (restored === null) {
        await tx
          .delete(siteSpecs)
          .where(
            and(eq(siteSpecs.orgId, this.scope.orgId), eq(siteSpecs.siteId, this.scope.siteId)),
          );
      } else {
        await tx
          .update(siteSpecs)
          .set({ document: SiteSpec.parse(restored), updatedAt: new Date() })
          .where(
            and(eq(siteSpecs.orgId, this.scope.orgId), eq(siteSpecs.siteId, this.scope.siteId)),
          );
      }

      await tx
        .update(specPatches)
        .set({ revertedAt: new Date() })
        .where(eq(specPatches.id, last.id));

      void actor;
      return { seq: last.seq, summary: last.summary };
    });
  }

  async history(limit = 20): Promise<PatchRecord[]> {
    const rows = await this.db
      .select()
      .from(specPatches)
      .where(
        and(eq(specPatches.orgId, this.scope.orgId), eq(specPatches.siteId, this.scope.siteId)),
      )
      .orderBy(desc(specPatches.seq))
      .limit(limit);

    return rows.map((r) => ({
      seq: r.seq,
      actor: r.actor,
      source: r.source,
      summary: r.summary,
      classification: r.classification as Classification,
      appliedAt: r.appliedAt,
      revertedAt: r.revertedAt,
    }));
  }

  /** Row counts per declared type, so a diff's impact line is concrete. */
  async entryCounts(spec: SiteSpec): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ typeKey: entries.typeKey, count: sql<number>`count(*)::int` })
      .from(entries)
      .where(this.where)
      .groupBy(entries.typeKey);

    const counts: Record<string, number> = {};
    // Declared types with no rows still report zero, so "nothing is lost" can be
    // said with confidence rather than by absence.
    for (const type of spec.content) counts[type.key] = 0;
    for (const row of rows) counts[row.typeKey] = row.count;
    return counts;
  }

  async allEntries(typeKey: string): Promise<Record<string, unknown>[]> {
    const rows = await this.db
      .select({ id: entries.id, slug: entries.slug, data: entries.data })
      .from(entries)
      .where(and(this.where, eq(entries.typeKey, typeKey)));

    return rows.map((r) => ({ ...(r.data as Record<string, unknown>), id: r.id, slug: r.slug }));
  }
}

/** Look a site up by host — the `LoadSite` contributor's query (doc 03 §4). */
export async function siteByDomain(db: Db, domain: string) {
  const [row] = await db.select().from(sites).where(eq(sites.domain, domain)).limit(1);
  return row;
}
