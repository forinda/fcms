/**
 * Who may do what (ADR 0041, implementing ADR 0008 §2).
 *
 * ADR 0008 put the role check "at the patch classifier" rather than on each
 * screen, and that is the rule this file exists to keep: a role is a set of
 * changes an actor may propose, checked once, so the admin, the CLI, MCP and
 * the assistant are all governed by the same line of code. A check per screen
 * would be five checks and four of them eventually wrong.
 */

/**
 * Ordered, least to most. `owner` is the account the install created — the only
 * one that can add or remove people.
 *
 * The five below it are ADR 0008's site roles, kept in its taxonomy rather than
 * invented here: if a new role does not map onto an existing mode, the model has
 * drifted.
 */
export const ROLES = ["viewer", "editor", "manager", "designer", "developer", "owner"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  viewer: "Can look, cannot change",
  editor: "Entries and pictures",
  manager: "Everything about the site's content and shape",
  designer: "Also the layout and the look",
  developer: "Also custom CSS, the CLI and plugins",
  owner: "Everything, including who else gets in",
};

const RANK: Record<Role, number> = Object.fromEntries(ROLES.map((r, i) => [r, i])) as Record<
  Role,
  number
>;

/** An unknown value is the least privilege there is, never the most. */
export const roleOf = (value: unknown): Role =>
  ROLES.includes(value as Role) ? (value as Role) : "viewer";

export const atLeast = (role: unknown, needed: Role): boolean => RANK[roleOf(role)] >= RANK[needed];

/**
 * What a role may not do, said the way it would be said to the person.
 *
 * A refusal that names the role and the thing is a refusal somebody can act on
 * — "ask whoever runs this site" is the next step, and it is in the sentence.
 */
export const refusal = (role: unknown, doing: string): string =>
  `Your account (${ROLE_LABELS[roleOf(role)]}) cannot ${doing}. Ask whoever runs this site.`;
