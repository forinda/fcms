/**
 * Your own account (ADR 0042).
 *
 * The people screen hands somebody a first password and says they can change it
 * once they are in. There was nowhere to. This is that screen's use-case, and
 * the two rules it exists for: prove you know the current password, and end
 * every other session when it changes.
 *
 * The second one is the point. A password is changed *because* somebody else
 * might know it — a shared laptop, a message with it in — and a change that
 * leaves the old sessions signed in does not do the thing it was done for.
 */
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";

import type { Db, OwnerRow } from "@forinda-cms/db";

import { DB } from "@/shared/db";
import { hashPassword, verifyPassword } from "@/shared/auth/passwords";
import { OwnerRepository } from "@/shared/repositories";

export type AccountResult = { ok: true; signedOutElsewhere: number } | { ok: false; error: string };

/** The same floor the installer and the people screen use. */
const MIN_PASSWORD = 12;

@Service({ scope: Lifetime.REQUEST })
export class AccountUseCase {
  private readonly owners: OwnerRepository;

  constructor(@Inject(DB) db: Db) {
    this.owners = new OwnerRepository(db);
  }

  async rename(actor: OwnerRow, name: string): Promise<AccountResult> {
    await this.owners.setName(actor.orgId, actor.id, name.trim() || null);
    return { ok: true, signedOutElsewhere: 0 };
  }

  async changePassword(
    actor: OwnerRow,
    values: { current: string; next: string; confirm: string },
    keepToken: string | undefined,
  ): Promise<AccountResult> {
    // The current password, every time. A session is enough to *use* the
    // admin; it is not enough to change the credential that outlives it, which
    // is the difference between a borrowed laptop and a stolen account.
    if (!(await verifyPassword(values.current, actor.passwordHash))) {
      return { ok: false, error: "That is not your current password." };
    }
    if (values.next.length < MIN_PASSWORD) {
      return { ok: false, error: `A password needs at least ${MIN_PASSWORD} characters.` };
    }
    if (values.next !== values.confirm) {
      return { ok: false, error: "The two new passwords are not the same." };
    }
    if (values.next === values.current) {
      return { ok: false, error: "That is the password you already have." };
    }

    await this.owners.setPassword(actor.orgId, actor.id, await hashPassword(values.next));

    // Everything except the browser doing this — including `fcms login` and the
    // MCP server, which hold sessions of their own (ADR 0015 §4). Signing those
    // out is the honest reading of "changed my password".
    const signedOutElsewhere = keepToken
      ? await this.owners.revokeOtherSessions(actor.id, keepToken)
      : 0;

    return { ok: true, signedOutElsewhere };
  }
}
