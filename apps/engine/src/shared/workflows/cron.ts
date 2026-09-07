/**
 * The five-field cron subset the platform understands.
 *
 * `minute hour day-of-month month day-of-week`, each one of: `*`, a number, a
 * list (`1,15`), a range (`9-17`) or a step (star-slash-15). Minute
 * resolution, which is what a tick can honour.
 *
 * Written here rather than taken as a dependency: it is forty lines against a
 * package in the deepest part of the supply chain — a scheduler runs on every
 * install, unattended, with the platform's authority (doc 05 §4). The tests
 * beside it are the argument that this is the cheaper risk.
 *
 * Deliberately absent: `@daily` and friends, `L`/`W`/`#`, seconds. A cron
 * expression this cannot parse is refused at validation rather than
 * approximated, because a schedule that runs at the wrong time is worse than
 * one that was rejected.
 */
const RANGES: readonly [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week, Sunday 0
];

/** The values one field matches, or null when the field is nonsense. */
function valuesOf(field: string, [min, max]: readonly [number, number]): Set<number> | null {
  const out = new Set<number>();

  for (const part of field.split(",")) {
    const [spec, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return null;

    let from: number;
    let to: number;
    if (spec === "*") {
      [from, to] = [min, max];
    } else if (spec?.includes("-")) {
      const [a, b] = spec.split("-").map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
      [from, to] = [a!, b!];
    } else {
      const one = Number(spec);
      if (!Number.isInteger(one)) return null;
      // A single value with a step means "from here on": `5/10` is 5, 15, 25…
      [from, to] = [one, stepText === undefined ? one : max];
    }

    if (from < min || to > max || from > to) return null;
    for (let value = from; value <= to; value += step) out.add(value);
  }

  return out.size > 0 ? out : null;
}

export interface Cron {
  matches(at: Date): boolean;
}

/** Null for an expression this does not understand — the caller refuses it. */
export function parseCron(expression: string): Cron | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const sets = fields.map((field, i) => valuesOf(field, RANGES[i]!));
  if (sets.some((set) => set === null)) return null;
  const [minute, hour, dom, month, dow] = sets as Set<number>[];

  return {
    matches(at: Date): boolean {
      // UTC, and said so out loud: an install's timezone is a setting, and a
      // scheduler that silently follows the host's clock moves everyone's
      // 9am when the server does.
      const dayMatches =
        // cron's own oddity, kept rather than fixed: when both day fields are
        // restricted the rule is *or*, not *and*.
        dom!.size === 31 || dow!.size === 7
          ? dom!.has(at.getUTCDate()) && dow!.has(at.getUTCDay())
          : dom!.has(at.getUTCDate()) || dow!.has(at.getUTCDay());

      return (
        minute!.has(at.getUTCMinutes()) &&
        hour!.has(at.getUTCHours()) &&
        month!.has(at.getUTCMonth() + 1) &&
        dayMatches
      );
    },
  };
}
