/**
 * Creating, updating and deleting entries.
 *
 * Every write goes through `validateEntry`, which is the layer doc 03 §2
 * accepted as the cost of `jsonb` over EAV: Postgres enforces nothing inside the
 * column, so an unvalidated write is a permanently wrong row. Putting it here
 * rather than in a controller means the admin, an API, an MCP tool and the AI
 * layer cannot each forget it differently.
 */
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";
import { validateEntry, type ContentType, type SiteSpec } from "@forinda-cms/spec";

import { UniqueViolationError, type ExpressionBuilder } from "@forinda/kickjs-db";
import { uniqueIndexName, type EntryRow } from "@forinda-cms/db";
import type { Db, Kdb, KdbSchema, Scope } from "@forinda-cms/db";
import { EntryRepository } from "@/shared/repositories";
import { WorkflowUseCase } from "@/shared/workflows/workflow.usecase";

import { DB, KDB } from "@/shared/db";
import { CURRENT_SCOPE } from "@/contributors/site.contributor";

export interface EntryInput {
  readonly typeKey: string;
  readonly slug?: string | undefined;
  readonly status?: "draft" | "published";
  readonly data: Record<string, unknown>;
  /**
   * The visitor who submitted this, when one did (ADR 0027).
   *
   * Only ever set by the submission route from a session cookie. An owner, the
   * CLI, MCP and the AI all leave it null, because none of them is a visitor.
   */
  readonly visitorId?: string | null;
}

export type EntryWriteResult =
  | { readonly ok: true; readonly entry: EntryRow }
  | { readonly ok: false; readonly errors: Record<string, string> };

@Service({ scope: Lifetime.REQUEST })
export class EntryWriteUseCase {
  private readonly repo: EntryRepository;
  private readonly workflows: WorkflowUseCase;

  constructor(
    // Drizzle only for the workflow queue, until that moves too (ADR 0052).
    @Inject(DB) db: Db,
    @Inject(CURRENT_SCOPE) private readonly scope: Scope,
    @Inject(KDB) private readonly kdb: Kdb,
  ) {
    this.repo = new EntryRepository(kdb, scope);
    this.workflows = new WorkflowUseCase(db, scope);
  }

  private typeOf(spec: SiteSpec, key: string): ContentType | undefined {
    return spec.content.find((t) => t.key === key);
  }

  private readonly scoped = (eb: ExpressionBuilder<KdbSchema, "entries">) =>
    eb.and([eb("orgId", "=", this.scope.orgId), eb("siteId", "=", this.scope.siteId)]);

  async create(spec: SiteSpec, input: EntryInput): Promise<EntryWriteResult> {
    const type = this.typeOf(spec, input.typeKey);
    if (!type) return { ok: false, errors: { _: `No content type named "${input.typeKey}".` } };

    // A derived type is computed, not stored (ADR 0014). Writing to one would
    // succeed and then be invisible, since nothing reads the table for it.
    if (type.derived)
      return { ok: false, errors: { _: `${type.label} is computed and cannot be edited.` } };

    const validation = validateEntry(type, input.data);
    if (!validation.ok) return { ok: false, errors: validation.errors ?? {} };

    try {
      const row = await this.kdb
        .insertInto("entries")
        .values({
          siteId: this.scope.siteId,
          orgId: this.scope.orgId,
          typeKey: input.typeKey,
          slug: input.slug ?? null,
          data: validation.data!,
          status: input.status ?? "draft",
          visitorId: input.visitorId ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Queued after the write, never inside it (ADR 0024 §1): the row is the
      // customer's and the automation is the owner's, so a slow webhook must
      // not make a booking slower and a broken one must not fail it.
      await this.workflows.enqueue(spec, {
        on: "entry.created",
        typeKey: input.typeKey,
        entryId: row.id,
      });

      return { ok: true, entry: row };
    } catch (error) {
      // A taken slug is a field the caller can fix, not a server fault. Left to
      // propagate it answered 500 with a SQL statement in the log and nothing
      // useful to the caller — a form would show no error, and an agent would
      // report the site as broken.
      if (!(error instanceof UniqueViolationError)) throw error;
      return { ok: false, errors: taken(this.scope.siteId, type, input, error) };
    }
  }

  async update(spec: SiteSpec, id: string, input: EntryInput): Promise<EntryWriteResult> {
    const type = this.typeOf(spec, input.typeKey);
    if (!type) return { ok: false, errors: { _: `No content type named "${input.typeKey}".` } };
    if (type.derived)
      return { ok: false, errors: { _: `${type.label} is computed and cannot be edited.` } };

    const validation = validateEntry(type, input.data);
    if (!validation.ok) return { ok: false, errors: validation.errors ?? {} };

    // Read before write: a transition is a *change*, so the previous state has
    // to be known before it is overwritten.
    const was = await this.repo.byId(id);

    let row: EntryRow | undefined;
    try {
      row = await this.kdb
        .updateTable("entries")
        .set({
          // Only when the caller said something about it. `slug: undefined`
          // means "not mentioned", and writing null for it clears the address
          // an entry is already published at — a partial update that silently
          // unpublishes a page is the worst kind of API.
          ...(input.slug === undefined ? {} : { slug: input.slug || null }),
          data: validation.data!,
          ...(input.status ? { status: input.status } : {}),
          updatedAt: new Date(),
        })
        // Scoped as well as keyed by id: an id from a request must not be able
        // to reach another site's row just because it is a valid uuid.
        .where(this.scoped)
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();
    } catch (error) {
      if (!(error instanceof UniqueViolationError)) throw error;
      return { ok: false, errors: taken(this.scope.siteId, type, input, error) };
    }

    if (!row) return { ok: false, errors: { _: "That entry no longer exists." } };

    await this.workflows.enqueue(spec, {
      on: "entry.updated",
      typeKey: input.typeKey,
      entryId: row.id,
    });

    // A `state` field that moved is its own event, and the one an owner
    // actually automates against: "when a booking becomes confirmed".
    const state = type.fields.find((f) => f.type === "state");
    const before = state ? String((was?.data as Record<string, unknown>)?.[state.name] ?? "") : "";
    const after = state ? String((row.data as Record<string, unknown>)[state.name] ?? "") : "";
    if (state && before !== after) {
      await this.workflows.enqueue(spec, {
        on: "entry.transitioned",
        typeKey: input.typeKey,
        entryId: row.id,
        to: after,
      });
    }

    return { ok: true, entry: row };
  }

  /**
   * Publish or unpublish one entry.
   *
   * Not a spec change, so it does not go through the patch spine: content is
   * data, and its history is the row's own `updatedAt`. What it *is* is the
   * boundary between "written" and "public", which is why it is one deliberate
   * action rather than a checkbox on the form that someone leaves ticked.
   */
  async setStatus(id: string, status: "draft" | "published"): Promise<boolean> {
    return this.repo.setStatus(id, status);
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.kdb
      .deleteFrom("entries")
      .where(this.scoped)
      .where("id", "=", id)
      .returning("id")
      .execute();
    return rows.length > 0;
  }

  find(id: string): Promise<EntryRow | null> {
    return this.repo.byId(id);
  }
}

/**
 * Which field the collision was on, said in the caller's words.
 *
 * The slug is not the only unique thing any more — a field declared `unique`
 * gets its own index (ADR 0009), so a booking reference or an invoice number
 * can collide too. Postgres names the index it refused on, and the index name
 * is a hash, so the field is found by asking which of this type's unique fields
 * the row is carrying a value for.
 *
 * Falls back to the slug, because that is what it was and what it usually is.
 */
function taken(
  siteId: string,
  type: ContentType,
  input: EntryInput,
  error: UniqueViolationError,
): Record<string, string> {
  const constraint = error.constraint ?? "";

  for (const field of type.fields) {
    if (!("unique" in field) || field.unique !== true) continue;
    if (constraint !== "" && constraint !== uniqueIndexName(siteId, type.key, field.name)) continue;
    const value = input.data[field.name];
    if (value === undefined || value === null || value === "") continue;
    return {
      [field.name]: `Another ${type.label} already uses "${String(value)}" for ${field.label}.`,
    };
  }

  return { slug: `Another ${type.label} already uses "${input.slug}".` };
}
