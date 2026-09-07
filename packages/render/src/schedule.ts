/**
 * The `schedule` derived-type generator (ADR 0014, decision 1).
 *
 * The spec declares the inputs — who is bookable, where their hours live, what
 * occupies time, how long a slot is, how far ahead to look. This owns the
 * algorithm. That split is what keeps availability declarative: an author cannot
 * write the rule, only choose its inputs.
 *
 * **Getting this wrong double-books a salon**, so it is deliberately
 * conservative: overlap is computed inclusively, lead time is enforced against a
 * caller-supplied `now`, and anything it cannot understand is treated as busy
 * rather than free. A false "unavailable" is an inconvenience; a false
 * "available" is two people in one chair.
 *
 * ## Known limitation: it works in server-local time
 *
 * Working hours are wall-clock ("09:00 means nine in the morning"), and this
 * resolves them against the *server's* timezone. A Nairobi salon on a US-hosted
 * server would compute the wrong day's slots — silently, and in the direction
 * that offers appointments nobody can keep.
 *
 * ADR 0014 listed timezones among this generator's costs. **Phase 0b must give
 * the site a declared timezone and resolve against that**, not the host's. The
 * spike is single-machine and local-time is correct there, so this is recorded
 * rather than solved — but it is a real bug the moment the site is deployed
 * somewhere its business is not.
 */
import { WeekHours, type DerivedSource } from '@forinda-cms/spec'

import type { Entry, EntrySource } from './entries.js'

/** `{ mon: [{ from: "09:00", to: "17:00" }], … }` on the resource. */
export interface DayWindow {
  readonly from: string
  readonly to: string
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

function minutesOfDay(hhmm: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return undefined
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return undefined
  return h * 60 + min
}

/**
 * Read one day's windows, validating the shape.
 *
 * Unparseable hours yield no windows, so the resource simply offers nothing.
 * That is the safe direction: a false "unavailable" is an inconvenience, a false
 * "available" is two people in one chair.
 */
function windowsFor(hours: unknown, date: Date): DayWindow[] {
  const parsed = WeekHours.safeParse(hours)
  if (!parsed.success) return []
  return parsed.data[DAY_KEYS[date.getDay()]!] ?? []
}

interface Busy {
  readonly start: number
  readonly end: number
}

/**
 * Existing bookings for one resource, as epoch-millisecond spans.
 *
 * A booking whose start or duration cannot be read is **skipped from the busy
 * list only if it is genuinely unparseable** — and when that happens the whole
 * resource is marked fully busy for the window by the caller, because silently
 * ignoring a booking is exactly how a double-booking happens.
 */
function busySpans(
  source: EntrySource,
  derived: Extract<DerivedSource, { kind: 'schedule' }>,
  resourceId: string,
): { spans: Busy[]; unreadable: boolean } {
  const spans: Busy[] = []
  let unreadable = false

  for (const row of source.all(derived.occupied.type)) {
    const owner = row[derived.occupied.resource]
    if (String(owner ?? '') !== resourceId) continue

    const startsAt = Date.parse(String(row[derived.occupied.start] ?? ''))
    const minutes = Number(row[derived.occupied.minutes])
    if (Number.isNaN(startsAt) || !Number.isFinite(minutes) || minutes <= 0) {
      unreadable = true
      continue
    }
    spans.push({ start: startsAt, end: startsAt + minutes * 60_000 })
  }
  return { spans, unreadable }
}

export interface ScheduleOptions {
  /** Injected so the generator is deterministic and testable. */
  readonly now: Date
}

/**
 * Compute available slots. One row per (resource, start), shaped like any entry
 * so `data`, `where`, `sort` and `limit` work on it unchanged.
 */
export function generateSchedule(
  source: EntrySource,
  derived: Extract<DerivedSource, { kind: 'schedule' }>,
  options: ScheduleOptions,
): Entry[] {
  const { now } = options
  const slotMs = derived.slot.minutes * 60_000
  const bufferMs = derived.slot.buffer * 60_000
  const earliest = now.getTime() + (derived.window.leadTime?.hours ?? 0) * 3_600_000

  const out: Entry[] = []

  for (const resource of source.all(derived.resource.type)) {
    const id = String(resource['slug'] ?? resource['id'] ?? '')
    if (!id) continue

    const { spans, unreadable } = busySpans(source, derived, id)
    // A booking we could not read means we do not know when this resource is
    // free. Offering slots anyway is the double-booking case, so offer none.
    if (unreadable) continue

    for (let dayOffset = 0; dayOffset < derived.window.days; dayOffset++) {
      const day = new Date(now)
      day.setDate(day.getDate() + dayOffset)
      day.setHours(0, 0, 0, 0)

      for (const window of windowsFor(resource[derived.resource.hours], day)) {
        const from = minutesOfDay(window.from)
        const to = minutesOfDay(window.to)
        if (from === undefined || to === undefined || to <= from) continue

        for (let m = from; m + derived.slot.minutes <= to; m += derived.slot.minutes) {
          const start = day.getTime() + m * 60_000
          const end = start + slotMs
          if (start < earliest) continue

          // Inclusive overlap, widened by the buffer on both sides.
          const clash = spans.some((b) => start < b.end + bufferMs && end + bufferMs > b.start)
          if (clash) continue

          out.push({
            id: `${id}:${new Date(start).toISOString()}`,
            [derived.resource.type]: id,
            startsAt: new Date(start).toISOString(),
            endsAt: new Date(end).toISOString(),
            minutes: derived.slot.minutes,
          })
        }
      }
    }
  }

  return out
}
