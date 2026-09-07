/**
 * The `stay` derived-type generator (ADR 0025).
 *
 * One row per resource that is free for **every night** in the requested range.
 * `schedule` answers "which start times exist"; this answers "which of these is
 * free for a span", which is the question a hotel, a rental and a hire company
 * all ask.
 *
 * Two rules carry it, and both are about being wrong in the safe direction:
 * nights are half-open, and anything unreadable is busy. A false "unavailable"
 * is an inconvenience; a false "available" is two families at one door.
 *
 * Unlike `schedule`, this has no timezone bug to inherit: a night is a calendar
 * date, parsed at UTC midnight, so the same range means the same nights
 * wherever the container runs.
 */
import type { DerivedSource } from "@forinda-cms/spec";

import type { Entry, EntrySource, RequestParams } from "./entries.js";

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` at UTC midnight. Anything else is not a date we will act on. */
export function calendarDate(value: unknown): number | null {
  const text = typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
  if (typeof text !== "string") return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text.trim());
  if (!match) return null;

  const at = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  // `Date.UTC` rolls 2026-02-31 into March rather than rejecting it, and a date
  // that means a different day than it says is a date to refuse.
  const back = new Date(at).toISOString().slice(0, 10);
  return back === `${match[1]}-${match[2]}-${match[3]}` ? at : null;
}

export interface StayOptions {
  readonly now: Date;
  readonly params: RequestParams;
}

/**
 * @returns rows for the resources free across the whole range. With no range
 *   asked for, every resource with `nights: null` — nothing has been claimed,
 *   because nothing was asked (ADR 0025 §3).
 */
export function generateStay(
  source: EntrySource,
  derived: Extract<DerivedSource, { kind: "stay" }>,
  options: StayOptions,
): Entry[] {
  const resources = source.all(derived.resource.type);
  const asked = {
    from: calendarDate(options.params[derived.range.from]),
    to: calendarDate(options.params[derived.range.to]),
  };

  const row = (resource: Entry, nights: number | null, from?: number, to?: number): Entry => ({
    ...resource,
    id: `${String(resource["slug"] ?? resource["id"] ?? "")}${from ? `:${iso(from)}` : ""}`,
    nights,
    checkIn: from === undefined ? null : iso(from),
    checkOut: to === undefined ? null : iso(to),
  });

  // Nobody has searched yet. Show what exists, claim nothing about it.
  if (asked.from === null && asked.to === null) {
    return resources.map((resource) => row(resource, null));
  }

  // Half a range, a backwards range, or dates that are not dates: no rows. The
  // alternative is a page reporting "8 rooms available" for a stay nobody can
  // book.
  if (asked.from === null || asked.to === null || asked.to <= asked.from) return [];

  const horizon =
    Date.UTC(options.now.getUTCFullYear(), options.now.getUTCMonth(), options.now.getUTCDate()) +
    derived.window.days * DAY_MS;
  if (asked.from < todayUtc(options.now) || asked.to > horizon) return [];

  const nights = Math.round((asked.to - asked.from) / DAY_MS);
  const out: Entry[] = [];

  for (const resource of resources) {
    const id = String(resource["slug"] ?? resource["id"] ?? "");
    if (!id) continue;

    const { busy, unreadable } = occupancy(source, derived, id);
    // A booking we could not read means we do not know when this is free.
    if (unreadable) continue;

    // Half-open: a booking that ends on the 7th does not occupy the night of
    // the 7th, so somebody else may check in that day. An inclusive comparison
    // hides a free night on every changeover day.
    const clash = busy.some((b) => b.from < asked.to! && b.to > asked.from!);
    if (clash) continue;

    out.push(row(resource, nights, asked.from, asked.to));
  }

  return out;
}

function todayUtc(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function iso(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** The nights already taken on one resource. */
function occupancy(
  source: EntrySource,
  derived: Extract<DerivedSource, { kind: "stay" }>,
  resourceId: string,
): { busy: { from: number; to: number }[]; unreadable: boolean } {
  const busy: { from: number; to: number }[] = [];
  let unreadable = false;

  for (const booking of source.all(derived.occupied.type)) {
    const owner = String(booking[derived.occupied.resource] ?? "");
    // A reference is stored as `ref:type/slug`; the resource is named by slug.
    if (owner !== resourceId && owner !== `ref:${derived.resource.type}/${resourceId}`) continue;

    const from = calendarDate(booking[derived.occupied.from]);
    const to = calendarDate(booking[derived.occupied.to]);
    if (from === null || to === null || to <= from) {
      unreadable = true;
      continue;
    }
    busy.push({ from, to });
  }

  return { busy, unreadable };
}
