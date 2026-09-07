/**
 * The sessions an owner has open, and closing them.
 *
 * Worth a screen because of what else exists: `fcms login` and the MCP server
 * both hold ordinary sessions (ADR 0015 §4 chose that over an API-key table so
 * a terminal's access could be listed and revoked like a browser's). That
 * promise is only kept if there is somewhere to do the listing and the
 * revoking.
 */
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";
import type { OwnerSessionRow } from "@forinda-cms/db";

import { DB } from "@/shared/db";
import type { Db } from "@forinda-cms/db";
import { OwnerRepository } from "@/shared/repositories/owner.repository";

export interface SessionView {
  readonly id: string;
  readonly what: string;
  readonly where: string;
  readonly started: Date;
  readonly lastUsed: Date | null;
  /** True for the session making this request — never offered a revoke button. */
  readonly current: boolean;
}

@Service({ scope: Lifetime.REQUEST })
export class SessionsUseCase {
  private readonly owners: OwnerRepository;

  constructor(@Inject(DB) db: Db) {
    this.owners = new OwnerRepository(db);
  }

  async list(ownerId: string, currentToken: string | undefined): Promise<SessionView[]> {
    const current = currentToken ? await this.owners.findBySessionToken(currentToken) : null;
    const rows = await this.owners.sessions(ownerId);

    return rows.map((row) => ({
      id: row.id,
      what: describe(row),
      where: row.ipAddress ?? "unknown address",
      started: row.createdAt,
      lastUsed: row.lastUsedAt,
      current: row.id === current?.session.id,
    }));
  }

  /**
   * Close one.
   *
   * Refusing to close the current session is not paternalism: the button for
   * that is Sign out, and a revoke that logs you out mid-list looks like a bug.
   */
  async revoke(ownerId: string, id: string, currentToken: string | undefined): Promise<boolean> {
    const current = currentToken ? await this.owners.findBySessionToken(currentToken) : null;
    if (current?.session.id === id) return false;
    return this.owners.revokeSession(ownerId, id);
  }

  /** "Sign out everywhere else" — the one button that matters after a laptop is lost. */
  async revokeOthers(ownerId: string, currentToken: string): Promise<number> {
    return this.owners.revokeOtherSessions(ownerId, currentToken);
  }
}

/**
 * What a session is, in a word.
 *
 * `fcms` sets its own user agent, so a terminal reads as a terminal rather than
 * as a mystery — which is the difference between "revoke that, I know what it
 * is" and leaving it alone.
 */
function describe(row: OwnerSessionRow): string {
  const agent = row.userAgent ?? "";
  if (agent === "fcms") return "Command line (fcms)";
  if (/edg\//i.test(agent)) return "Edge";
  if (/chrome\//i.test(agent)) return "Chrome";
  if (/safari\//i.test(agent) && !/chrome/i.test(agent)) return "Safari";
  if (/firefox\//i.test(agent)) return "Firefox";
  return agent === "" ? "Unknown" : agent.slice(0, 40);
}
