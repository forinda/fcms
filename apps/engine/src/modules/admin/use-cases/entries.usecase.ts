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
import { and, eq } from "drizzle-orm";
import { validateEntry, type ContentType, type SiteSpec } from "@forinda-cms/spec";

import { entries, type EntryRow } from "@forinda-cms/db";
import type { Db, Scope } from "@forinda-cms/db";
import { EntryRepository } from "@/shared/repositories";

import { DB } from "@/shared/db";
import { CURRENT_SCOPE } from "@/contributors/site.contributor";

export interface EntryInput {
  readonly typeKey: string;
  readonly slug?: string | undefined;
  readonly status?: "draft" | "published";
  readonly data: Record<string, unknown>;
}

export type EntryWriteResult =
  | { readonly ok: true; readonly entry: EntryRow }
  | { readonly ok: false; readonly errors: Record<string, string> };

@Service({ scope: Lifetime.REQUEST })
export class EntryWriteUseCase {
  private readonly repo: EntryRepository;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CURRENT_SCOPE) private readonly scope: Scope,
  ) {
    this.repo = new EntryRepository(db, scope);
  }

  private typeOf(spec: SiteSpec, key: string): ContentType | undefined {
    return spec.content.find((t) => t.key === key);
  }

  private get scoped() {
    return and(eq(entries.orgId, this.scope.orgId), eq(entries.siteId, this.scope.siteId));
  }

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
      const [row] = await this.db
        .insert(entries)
        .values({
          siteId: this.scope.siteId,
          orgId: this.scope.orgId,
          typeKey: input.typeKey,
          slug: input.slug ?? null,
          data: validation.data!,
          status: input.status ?? "draft",
        })
        .returning();

      return { ok: true, entry: row! };
    } catch (error) {
      // A taken slug is a field the caller can fix, not a server fault. Left to
      // propagate it answered 500 with a SQL statement in the log and nothing
      // useful to the caller — a form would show no error, and an agent would
      // report the site as broken.
      if (!isUniqueViolation(error)) throw error;
      return { ok: false, errors: { slug: `Another ${type.label} already uses "${input.slug}".` } };
    }
  }

  async update(spec: SiteSpec, id: string, input: EntryInput): Promise<EntryWriteResult> {
    const type = this.typeOf(spec, input.typeKey);
    if (!type) return { ok: false, errors: { _: `No content type named "${input.typeKey}".` } };
    if (type.derived)
      return { ok: false, errors: { _: `${type.label} is computed and cannot be edited.` } };

    const validation = validateEntry(type, input.data);
    if (!validation.ok) return { ok: false, errors: validation.errors ?? {} };

    let row: EntryRow | undefined;
    try {
      [row] = await this.db
        .update(entries)
        .set({
          slug: input.slug ?? null,
          data: validation.data!,
          ...(input.status ? { status: input.status } : {}),
          updatedAt: new Date(),
        })
        // Scoped as well as keyed by id: an id from a request must not be able
        // to reach another site's row just because it is a valid uuid.
        .where(and(this.scoped, eq(entries.id, id)))
        .returning();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return { ok: false, errors: { slug: `Another ${type.label} already uses "${input.slug}".` } };
    }

    if (!row) return { ok: false, errors: { _: "That entry no longer exists." } };
    return { ok: true, entry: row };
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(entries)
      .where(and(this.scoped, eq(entries.id, id)))
      .returning({ id: entries.id });
    return rows.length > 0;
  }

  find(id: string): Promise<EntryRow | null> {
    return this.repo.byId(id);
  }
}

/**
 * Postgres' unique-violation code, wherever the driver put it.
 *
 * Drizzle wraps the driver error, so the code can be on the error or on its
 * cause — checking only one is how this reads as "not a unique violation" and
 * becomes a 500.
 */
function isUniqueViolation(error: unknown): boolean {
  for (let current = error; current; current = (current as { cause?: unknown }).cause) {
    if ((current as { code?: unknown }).code === "23505") return true;
  }
  return false;
}
