/**
 * Who is asking, and about which site.
 *
 * Taken in a repository's constructor rather than passed per call. ADR 0002
 * seam 1 requires every query to be scoped, and the seam only pays off if
 * nothing can bypass it — a method that forgot the filter would be a
 * cross-tenant read, and forgetting is what the shape has to prevent.
 */
export interface Scope {
  readonly orgId: string;
  readonly siteId: string;
}
