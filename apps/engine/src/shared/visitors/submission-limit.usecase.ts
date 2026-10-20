/**
 * How often a stranger may post.
 *
 * Reuses the `login_attempts` table rather than adding another: both answer
 * "how many times has this address done this recently", both need to survive a
 * restart, and a second table would be a second thing to prune.
 *
 * The key is namespaced so a burst of submissions cannot lock somebody out of
 * signing in, which would turn a spam wave into a denial of service against the
 * owner.
 */
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";
import type { Kdb } from "@forinda-cms/db";

import { KDB } from "@/shared/db";

/** Ten in ten minutes: generous for a person, useless for a script. */
export const SUBMISSIONS_ALLOWED = 10;
export const SUBMISSION_WINDOW_MS = 10 * 60 * 1000;

@Service({ scope: Lifetime.REQUEST })
export class SubmissionLimitUseCase {
  constructor(@Inject(KDB) private readonly db: Kdb) {}

  async allow(typeKey: string, visitorId: string | null, ip: string | null): Promise<boolean> {
    const since = new Date(Date.now() - SUBMISSION_WINDOW_MS);
    const key = this.key(typeKey, visitorId);

    const rows = await this.db
      .selectFrom("login_attempts")
      .select("id")
      // Submissions only — see the note on `kind` in the schema.
      .where("kind", "=", "submit")
      .where("at", ">", since)
      .where((eb) =>
        ip ? eb.or([eb("email", "=", key), eb("ipAddress", "=", ip)]) : eb("email", "=", key),
      )
      .execute();

    return rows.length < SUBMISSIONS_ALLOWED;
  }

  async record(typeKey: string, visitorId: string | null, ip: string | null): Promise<void> {
    await this.db
      .insertInto("login_attempts")
      .values({ kind: "submit", email: this.key(typeKey, visitorId), ipAddress: ip })
      .execute();
  }

  /** Namespaced so it can never collide with a real email address. */
  private key(typeKey: string, visitorId: string | null): string {
    return `submit:${typeKey}:${visitorId ?? "anon"}`;
  }
}
