/**
 * The people who can sign in (ADR 0041).
 *
 * ADR 0008 puts invitations and member management in Phase 1, and this is the
 * smallest part of it that a real business needs before then: an owner adding
 * the person who answers the phone, with a role that stops them rearranging the
 * site by accident.
 *
 * No invitation emails, no tokens, no expiry — the owner sets a first password
 * and hands it over, which is what happens in a salon anyway. What it does have
 * is the two refusals that matter: nobody can promote themselves, and the last
 * owner cannot be removed or demoted.
 */
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";

import type { Db } from "@forinda-cms/db";
import type { OwnerRow } from "@forinda-cms/db";

import { DB } from "@/shared/db";
import { hashPassword } from "@/shared/auth/passwords";
import { OwnerRepository } from "@/shared/repositories";
import { atLeast, roleOf, type Role } from "@/shared/roles";

export interface PeopleInput {
  /** The account doing this. */
  readonly actor: OwnerRow;
}

export type PeopleResult = { ok: true } | { ok: false; error: string };

/** Long enough to be worth hashing. The same floor the installer uses. */
const MIN_PASSWORD = 12;

@Service({ scope: Lifetime.REQUEST })
export class PeopleUseCase {
  private readonly owners: OwnerRepository;

  constructor(@Inject(DB) db: Db) {
    this.owners = new OwnerRepository(db);
  }

  list(orgId: string): Promise<OwnerRow[]> {
    return this.owners.list(orgId);
  }

  async add(
    input: PeopleInput,
    values: { email: string; name: string; password: string; role: string },
  ): Promise<PeopleResult> {
    const refused = this.mayManage(input);
    if (refused) return refused;

    const email = values.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return { ok: false, error: "That is not an email address." };
    if (values.password.length < MIN_PASSWORD) {
      return { ok: false, error: `A password needs at least ${MIN_PASSWORD} characters.` };
    }
    if (await this.owners.findByEmail(email)) {
      return { ok: false, error: "Somebody already signs in with that address." };
    }

    const role = roleOf(values.role);
    // Only an owner can make another owner, and an owner is what this check
    // already requires — but saying it here keeps the rule in one place if the
    // gate above ever loosens.
    if (role === "owner" && !atLeast(input.actor.role, "owner")) {
      return { ok: false, error: "Only an owner can add another owner." };
    }

    await this.owners.create({
      orgId: input.actor.orgId,
      email,
      name: values.name.trim() || undefined,
      passwordHash: await hashPassword(values.password),
      role,
    });
    return { ok: true };
  }

  async setRole(input: PeopleInput, id: string, role: string): Promise<PeopleResult> {
    const refused = this.mayManage(input);
    if (refused) return refused;

    const person = await this.owners.findById(id);
    if (!person) return { ok: false, error: "That account no longer exists." };

    // Nobody changes their own role. An owner who demotes themselves by
    // accident has locked themselves out of the screen that would undo it.
    if (person.id === input.actor.id) {
      return { ok: false, error: "You cannot change your own role." };
    }
    if (await this.lastOwner(person)) {
      return { ok: false, error: "This is the last owner, so its role cannot change." };
    }

    await this.owners.setRole(id, roleOf(role));
    return { ok: true };
  }

  async remove(input: PeopleInput, id: string): Promise<PeopleResult> {
    const refused = this.mayManage(input);
    if (refused) return refused;

    const person = await this.owners.findById(id);
    if (!person) return { ok: false, error: "That account is already gone." };
    if (person.id === input.actor.id) {
      return { ok: false, error: "You cannot remove your own account." };
    }
    if (await this.lastOwner(person)) {
      return { ok: false, error: "This is the last owner. Make somebody else an owner first." };
    }

    await this.owners.remove(id);
    return { ok: true };
  }

  /** Would removing or demoting this account leave the site with no owner? */
  private async lastOwner(person: OwnerRow): Promise<boolean> {
    if (roleOf(person.role) !== "owner") return false;
    return (await this.owners.countWithRole(person.orgId, "owner")) <= 1;
  }

  private mayManage(input: PeopleInput): PeopleResult | null {
    return atLeast(input.actor.role, "owner")
      ? null
      : { ok: false, error: "Only an owner can add or remove people." };
  }
}

export type { Role };
