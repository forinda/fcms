/**
 * Apply a new spec.
 *
 * The one operation everything else routes through: chat, the canvas, the
 * language, the CLI and any harness all reduce to this (research/11). So the
 * decisions live here rather than in a repository — what counts as destructive,
 * whether it is allowed, what the schema has to do about it, and what gets
 * recorded so it can be undone.
 */
import { classify, diffSpecs, SiteSpec, type SpecChange } from "@forinda-cms/spec";

import type { Db } from "../client.js";
import { planMigration, runMigration, type MigrationStep } from "../planner.js";
import { EntryRepository, PatchRepository, SpecRepository } from "../repositories/index.js";
import type { Scope } from "../scope.js";

export interface ApplySpecInput {
  readonly actor: string;
  /** chat | canvas | cli | mcp — recorded so history says which door a change came through. */
  readonly source: string;
  readonly harness?: string | undefined;
  /**
   * Destructive changes need an explicit yes. Refusing by default is what makes
   * the gate real rather than advisory — a caller that means it says so.
   */
  readonly allowDestructive?: boolean;
}

export interface ApplySpecResult {
  readonly seq: number;
  readonly changes: SpecChange[];
  readonly migration: MigrationStep[];
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

export class ApplySpecUseCase {
  private readonly specs: SpecRepository;
  private readonly patches: PatchRepository;
  private readonly entries: EntryRepository;

  constructor(
    private readonly db: Db,
    private readonly scope: Scope,
  ) {
    this.specs = new SpecRepository(db, scope);
    this.patches = new PatchRepository(db, scope);
    this.entries = new EntryRepository(db, scope);
  }

  async execute(next: SiteSpec, input: ApplySpecInput): Promise<ApplySpecResult> {
    // Validated on the way *in*, not only on the way out. A bad document was
    // survivable before — but it would surface at the next render rather than
    // at the write that caused it, with a patch already recorded and an inverse
    // pointing at it.
    const validated = SiteSpec.parse(next);
    const current = await this.specs.find();

    const counts = await this.entryCounts(current);
    const changes = current ? diffSpecs(current, validated, counts) : [];
    const destructive = changes.filter((c) => c.classification === "destructive");

    if (destructive.length > 0 && input.allowDestructive !== true) {
      throw new DestructiveChangeError(destructive);
    }

    const ops = [{ op: "set" as const, path: "/", value: validated }];
    const inverse = [{ op: "set" as const, path: "/", value: current ?? null }];
    const plan = planMigration(current ?? undefined, validated, { siteId: this.scope.siteId });

    return this.db.transaction(async (tx) => {
      const seq = await this.patches.nextSeq(tx);
      await this.specs.save(validated, tx);

      await this.patches.record(
        seq,
        {
          ops,
          inverse,
          classification: destructive.length > 0 ? "destructive" : classify(ops),
          summary: summarise(changes, destructive.length),
          actor: input.actor,
          source: input.source,
          harness: input.harness,
        },
        tx,
      );

      // In the same transaction as the spec write. A spec saying a field is
      // gone while its index still exists is a state no later run can reason
      // about, so they land together or not at all.
      const { applied } = await runMigration(tx, plan, {
        allowDestructive: input.allowDestructive === true,
      });

      return { seq, changes, migration: applied };
    });
  }

  /**
   * Declared types with no rows still report zero, so "nothing is lost" can be
   * said with confidence rather than inferred from an absent key.
   */
  private async entryCounts(spec: SiteSpec | null): Promise<Record<string, number>> {
    if (!spec) return {};
    const zeros = Object.fromEntries(spec.content.map((t) => [t.key, 0]));
    return { ...zeros, ...(await this.entries.countsByType()) };
  }
}

function summarise(changes: readonly SpecChange[], destructive: number): string {
  if (changes.length === 0) return "No visible change.";
  if (changes.length === 1) return changes[0]!.summary;
  return `${changes.length} changes, ${destructive} destructive.`;
}
