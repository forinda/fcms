/**
 * Where a moved page went.
 *
 * ADR 0002 put structural SEO in Phase 0b for one reason: *"the automatic 301
 * only works because the patch inverse already recorded the old path."* This is
 * that, and it lives here rather than in the app so it is testable next to the
 * data it reads — the first version duplicated the rule into the HTTP layer,
 * where the test had to reimplement it to check it.
 */
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";
import { valueOf } from "@forinda-cms/spec";

import type { Db, Scope } from "@forinda-cms/db";
import { PatchRepository, SpecRepository } from "@/shared/repositories";

import { DB } from "@/shared/db";
import { CURRENT_SCOPE } from "@/contributors/site.contributor";

@Service({ scope: Lifetime.REQUEST })
export class RedirectsUseCase {
  private readonly specs: SpecRepository;
  private readonly patches: PatchRepository;

  constructor(@Inject(DB) db: Db, @Inject(CURRENT_SCOPE) scope: Scope) {
    this.specs = new SpecRepository(db, scope);
    this.patches = new PatchRepository(db, scope);
  }

  /** Old path → current path, for every page that still exists somewhere else. */
  async execute(limit = 200): Promise<Map<string, string>> {
    const spec = await this.specs.find();
    if (!spec) return new Map();

    const live = new Set(spec.pages.map((p) => p.path));
    const byKey = new Map(spec.pages.map((p) => [p.key, p.path]));
    const out = new Map<string, string>();

    for (const patch of await this.patches.list(limit)) {
      const previous = valueOf(patch.inverse[0]);
      if (!isSpecLike(previous)) continue;

      for (const old of previous.pages) {
        const now = byKey.get(old.key);
        // Only when the page still exists elsewhere. A deleted page has nowhere
        // to send anyone, and redirecting it to the homepage tells a search
        // engine the content moved when it did not — worse than an honest 404.
        // A path another page has since taken is skipped for the same reason in
        // reverse: redirecting it would make the new page unreachable.
        if (!now || now === old.path || live.has(old.path)) continue;
        if (!out.has(old.path)) out.set(old.path, now);
      }
    }
    return out;
  }
}

/** A previous spec, loosely: enough to read page paths without parsing it whole. */
function isSpecLike(value: unknown): value is { pages: { key: string; path: string }[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { pages?: unknown }).pages)
  );
}
