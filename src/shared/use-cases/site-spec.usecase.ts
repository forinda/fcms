/**
 * The site's current spec.
 *
 * One line over the repository, and worth its own class: every surface that
 * renders — the public site, the admin, the sitemap — starts here, and a
 * controller reaching into a repository is how the data layer ends up in the
 * HTTP layer. This is also the seam a cache goes behind, since the spec changes
 * once per patch and is read on every request.
 */
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";
import type { SiteSpec } from "@forinda-cms/spec";

import { SpecRepository } from "@/shared/repositories";

@Service({ scope: Lifetime.REQUEST })
export class SiteSpecUseCase {
  constructor(@Inject(SpecRepository) private readonly specs: SpecRepository) {}

  /** `null` on a site that has never been published to. */
  execute(): Promise<SiteSpec | null> {
    return this.specs.find();
  }
}
