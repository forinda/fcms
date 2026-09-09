/**
 * Apply a new spec.
 *
 * The one operation everything else routes through: chat, the canvas, the
 * language, the CLI and any harness all reduce to this. So the
 * decisions live here rather than in a repository — what counts as destructive,
 * whether it is allowed, what the schema has to do about it, and what gets
 * recorded so it can be undone.
 */
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";
import { checkReferences, classify, diffSpecs, SiteSpec, type SpecChange } from "@forinda-cms/spec";

import { planMigration, reconcileIndexes, runMigration, type MigrationStep } from "@forinda-cms/db";
import type { Db, Scope } from "@forinda-cms/db";
import { EntryRepository, PatchRepository, SpecRepository } from "@/shared/repositories";

import { DB } from "@/shared/db";
import { atLeast, refusal, roleOf, type Role } from "@/shared/roles";
import { CURRENT_SCOPE } from "@/contributors/site.contributor";

export interface ApplySpecInput {
  readonly actor: string;
  /**
   * What the actor may propose (ADR 0008 §2).
   *
   * Required, not optional with a permissive default: every door into this —
   * the admin, the CLI, MCP, the assistant, the installer — has to say who is
   * knocking, and the compiler is what makes sure a new one does too.
   */
  readonly role: Role;
  /** chat | canvas | cli | mcp — recorded so history says which door a change came through. */
  readonly source: string;
  readonly harness?: string | undefined;
  /**
   * Destructive changes need an explicit yes. Refusing by default is what makes
   * the gate real rather than advisory — a caller that means it says so.
   */
  readonly allowDestructive?: boolean;
}

export interface PlanResult {
  readonly changes: SpecChange[];
  readonly destructive: SpecChange[];
  readonly migration: MigrationStep[];
  /** True when the site has no spec yet, so there is nothing to diff against. */
  readonly initial: boolean;
}

export interface ApplySpecResult {
  readonly seq: number;
  readonly changes: SpecChange[];
  readonly migration: MigrationStep[];
}

/**
 * A change this actor may not make.
 *
 * Separate from `DestructiveChangeError` because they are different answers:
 * one is "are you sure", the other is "not you". A screen that conflated them
 * would offer a confirm button to somebody who cannot press it.
 */
export class NotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotAllowedError";
  }
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

/**
 * Shape *and* references, at the one door every writer comes through.
 *
 * `SiteSpec.parse` was catching a malformed block and missing a dangling one —
 * a query against a deleted type, a component instance naming a component that
 * is not there. Those are exactly the changes that render as a blank section
 * rather than an error, so a spec is only well-formed here if `checkReferences`
 * agrees. The canvas, the chat, the CLI and MCP all land on this line.
 */
function validate(next: SiteSpec): SiteSpec {
  const spec = SiteSpec.parse(next);
  const issues = checkReferences(spec);
  if (issues.length > 0) {
    throw new Error(issues.map((i) => `${i.path}: ${i.message}`).join("; "));
  }
  return spec;
}

@Service({ scope: Lifetime.REQUEST })
export class ApplySpecUseCase {
  private readonly specs: SpecRepository;
  private readonly patches: PatchRepository;
  private readonly entries: EntryRepository;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CURRENT_SCOPE) private readonly scope: Scope,
  ) {
    this.specs = new SpecRepository(db, scope);
    this.patches = new PatchRepository(db, scope);
    this.entries = new EntryRepository(db, scope);
  }

  /**
   * What `execute` *would* do, without doing it.
   *
   * `fcms plan` and the apply that follows must agree, and the only way to
   * guarantee that is for both to run this — the classification, the counts the
   * impact lines are computed from, and the migration steps all come from here.
   * A second implementation of "what changed" is a second answer.
   */
  async plan(next: SiteSpec): Promise<PlanResult> {
    const validated = validate(next);
    const current = await this.specs.find();

    const changes = current ? diffSpecs(current, validated, await this.entryCounts(current)) : [];

    return {
      changes,
      destructive: changes.filter((c) => c.classification === "destructive"),
      migration: planMigration(current ?? undefined, validated, { siteId: this.scope.siteId }),
      // A first publish is not a diff — there is nothing to compare against, and
      // reporting "no changes" for it would be a lie a caller acts on.
      initial: current === null,
    };
  }

  async execute(next: SiteSpec, input: ApplySpecInput): Promise<ApplySpecResult> {
    // Before anything else, including validation: what an actor may not
    // propose, they may not have judged either.
    const refused = notAllowed(input.role, next, await this.specs.find());
    if (refused) throw new NotAllowedError(refused);

    // Validated on the way *in*, not only on the way out. A bad document was
    // survivable before — but it would surface at the next render rather than
    // at the write that caused it, with a patch already recorded and an inverse
    // pointing at it.
    const validated = validate(next);
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

      // The plan is what a person agreed to; this is what makes the indexes
      // true. An index is derived state — what should exist is a function of
      // the spec, not of the diff — so anything the diff could not see is
      // repaired here rather than never. It is idempotent, and a site whose
      // indexes already match does nothing and reports nothing.
      //
      // Not for a destructive plan that was refused: the spec did not fully
      // land, so reconciling to it would enforce a shape the caller declined.
      if (applied.length === plan.length) {
        await reconcileIndexes(tx, validated, { siteId: this.scope.siteId });
      }

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

/**
 * The two things a role can stop, and nothing else.
 *
 * Not a permission per screen — ADR 0008's rule is that a role is a set of
 * *changes*, so the check is over the change. Everything below `manager` edits
 * entries and media rather than the spec, and tier-3 CSS is the developer's
 * (ADR 0004: it is the one explicit escape hatch, and it is gated).
 */
function notAllowed(claimed: Role, next: SiteSpec, current: SiteSpec | null): string | null {
  // Normalised first: a caller inventing a role gets the bottom of the ladder,
  // never the benefit of an unrecognised name.
  const role = roleOf(claimed);
  if (!atLeast(role, "manager")) {
    return refusal(role, "change how the site is put together");
  }

  if (!atLeast(role, "developer") && customCssChanged(next, current)) {
    return refusal(role, "change the site's custom CSS");
  }
  return null;
}

/** Site-level or block-level tier 3, added, removed or edited. */
function customCssChanged(next: SiteSpec, current: SiteSpec | null): boolean {
  // Sorted: moving a block does not change its CSS, and refusing a reorder
  // because tier 3 came out in a different order would be nonsense.
  return JSON.stringify(cssOf(next).sort()) !== JSON.stringify(cssOf(current).sort());
}

function cssOf(spec: SiteSpec | null): string[] {
  if (!spec) return [];
  // Only the rules that exist. Collecting a `null` per page would make a first
  // apply — where there is nothing to compare against — look like a change,
  // and a manager could not publish a site at all.
  const found: string[] = [];
  if (spec.css !== undefined) found.push(spec.css);
  const walk = (blocks: readonly { css?: string; children?: unknown[]; item?: unknown[] }[]) => {
    for (const block of blocks) {
      if (block.css !== undefined) found.push(block.css);
      walk((block.children ?? []) as never);
      walk((block.item ?? []) as never);
    }
  };
  for (const page of spec.pages) {
    if (page.css !== undefined) found.push(page.css);
    walk(page.blocks as never);
  }
  for (const component of spec.components) walk(component.blocks as never);
  walk((spec.layout?.header ?? []) as never);
  walk((spec.layout?.footer ?? []) as never);
  return found;
}

function summarise(changes: readonly SpecChange[], destructive: number): string {
  if (changes.length === 0) return "No visible change.";
  if (changes.length === 1) return changes[0]!.summary;
  return `${changes.length} changes, ${destructive} destructive.`;
}
