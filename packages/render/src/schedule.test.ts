/**
 * Schedule generator tests.
 *
 * Getting this wrong double-books a salon, so the bias throughout is that a
 * false "unavailable" is an inconvenience and a false "available" is two people
 * in one chair. Several tests below assert the *absence* of slots, which is the
 * direction that matters.
 */
import { describe, expect, it } from 'vitest'
import type { DerivedSource } from '@forinda-cms/spec'

import { staticSource } from './entries.js'
import { generateSchedule } from './schedule.js'

const derived: Extract<DerivedSource, { kind: 'schedule' }> = {
  kind: 'schedule',
  resource: { type: 'staff', hours: 'workingHours' },
  occupied: { type: 'booking', resource: 'stylist', start: 'startsAt', minutes: 'minutes' },
  slot: { minutes: 30, buffer: 0 },
  window: { days: 1, leadTime: { hours: 0 } },
}

/**
 * 2026-09-08 is a Tuesday. Built in **local** time, and every instant below with
 * it, because the generator resolves wall-clock working hours against the
 * server's timezone (see the note in `schedule.ts`). UTC literals here would
 * make these tests pass or fail depending on where they run — which is exactly
 * the bug the note describes, so the tests should not paper over it.
 */
const TUESDAY = new Date(2026, 8, 8, 0, 0, 0, 0)

/** An ISO instant for a wall-clock time on that Tuesday. */
const at = (hour: number, minute = 0) => new Date(2026, 8, 8, hour, minute, 0, 0).toISOString()

const staff = (workingHours: unknown) => [{ slug: 'amina', name: 'Amina', workingHours }]
const tuesday9to12 = { tue: [{ from: '09:00', to: '12:00' }] }

function slots(bookings: Record<string, unknown>[] = [], hours: unknown = tuesday9to12, overrides = {}) {
  const source = staticSource({ staff: staff(hours), booking: bookings })
  return generateSchedule(source, { ...derived, ...overrides }, { now: TUESDAY })
}

describe('slot generation', () => {
  it('fills a working window in slot-sized steps', () => {
    // 09:00–12:00 is three hours; 30-minute slots give six.
    expect(slots().length).toBe(6)
  })

  it('never runs a slot past the end of the window', () => {
    // 09:00–09:50 fits one 30-minute slot, not two.
    expect(slots([], { tue: [{ from: '09:00', to: '09:50' }] }).length).toBe(1)
  })

  it('produces nothing on a day with no declared hours', () => {
    expect(slots([], { wed: [{ from: '09:00', to: '17:00' }] })).toEqual([])
  })

  it('handles several windows in one day', () => {
    const split = { tue: [{ from: '09:00', to: '10:00' }, { from: '14:00', to: '15:00' }] }
    expect(slots([], split).length).toBe(4)
  })
})

describe('existing bookings remove slots', () => {
  const booking = (startsAt: string, minutes: number) => ({ stylist: 'amina', startsAt, minutes })

  it('removes a slot that is exactly taken', () => {
    const taken = slots([booking(at(9), 30)])
    expect(taken.length).toBe(5)
    expect(taken.some((s) => s['startsAt'] === at(9))).toBe(false)
  })

  it('removes every slot a long booking overlaps', () => {
    // 09:00 + 90 minutes covers 09:00, 09:30 and 10:00.
    expect(slots([booking(at(9), 90)]).length).toBe(3)
  })

  it('removes a slot a booking only partly overlaps', () => {
    // 09:15–09:45 touches both the 09:00 and 09:30 slots.
    expect(slots([booking(at(9, 15), 30)]).length).toBe(4)
  })

  it('ignores bookings belonging to another resource', () => {
    const other = [{ stylist: 'joy', startsAt: at(9), minutes: 30 }]
    expect(slots(other).length).toBe(6)
  })

  it('applies the buffer on both sides', () => {
    // A booking outside working hours costs nothing.
    const outside = slots([booking(at(20), 30)], tuesday9to12, { slot: { minutes: 30, buffer: 15 } })
    expect(outside.length).toBe(6)

    // A 09:30 booking with a 15-minute buffer blocks the slot before it *and*
    // the one after: 09:00 ends at 09:30 and 10:00 starts at 10:00, both within
    // a quarter hour of the booking. Six slots minus three leaves three.
    const clashing = slots([booking(at(9, 30), 30)], tuesday9to12, { slot: { minutes: 30, buffer: 15 } })
    expect(clashing.length).toBe(3)
  })
})

describe('failing safe', () => {
  it('offers nothing when a booking cannot be read', () => {
    // Silently skipping an unparseable booking is exactly how a double-booking
    // happens, so the whole resource goes dark instead.
    expect(slots([{ stylist: 'amina', startsAt: 'not a date', minutes: 30 }])).toEqual([])
    expect(slots([{ stylist: 'amina', startsAt: at(9), minutes: 0 }])).toEqual([])
  })

  it('offers nothing when working hours are malformed', () => {
    expect(slots([], { tue: [{ from: '25:00', to: '99:99' }] })).toEqual([])
    expect(slots([], { tue: [{ from: '17:00', to: '09:00' }] })).toEqual([])
    expect(slots([], 'not an object')).toEqual([])
  })

  it('offers nothing when the hours field is absent', () => {
    // Built directly rather than via `slots(…, undefined)`, which would hit the
    // default parameter and silently test the happy path instead.
    const source = staticSource({ staff: [{ slug: 'amina', name: 'Amina' }], booking: [] })
    expect(generateSchedule(source, derived, { now: TUESDAY })).toEqual([])
  })

  it('skips a resource with no slug or id', () => {
    const source = staticSource({ staff: [{ name: 'Nameless', workingHours: tuesday9to12 }], booking: [] })
    expect(generateSchedule(source, derived, { now: TUESDAY })).toEqual([])
  })
})

describe('lead time', () => {
  it('hides slots inside the lead time', () => {
    const source = staticSource({ staff: staff(tuesday9to12), booking: [] })
    const midMorning = new Date(2026, 8, 8, 9, 0, 0, 0)
    const withLead = generateSchedule(source, { ...derived, window: { days: 1, leadTime: { hours: 2 } } }, { now: midMorning })
    // Only slots from 11:00 survive a two-hour lead time.
    expect(withLead.every((s) => Date.parse(String(s['startsAt'])) >= midMorning.getTime() + 7_200_000)).toBe(true)
    expect(withLead.length).toBe(2)
  })
})

describe('rows look like entries', () => {
  it('carries the fields a query and a template can read', () => {
    const first = slots()[0]!
    expect(first).toMatchObject({ staff: 'amina', minutes: 30 })
    expect(typeof first['startsAt']).toBe('string')
    expect(typeof first['endsAt']).toBe('string')
    // A stable id, so re-rendering the same window produces the same rows.
    expect(first['id']).toBe(`amina:${at(9)}`)
  })

  it('is deterministic for the same inputs', () => {
    expect(slots()).toEqual(slots())
  })
})
