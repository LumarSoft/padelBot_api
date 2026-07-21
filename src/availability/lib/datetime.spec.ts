/**
 * The club's wall clock is the invariant this whole product rests on: a slot shown,
 * booked, reminded or confirmed one hour off is a player standing at a court someone
 * else is playing on.
 *
 * In production the API runs on a UTC host while the club lives in Buenos Aires (UTC-3),
 * so every bug in this class hides on a developer's machine (which IS in Buenos Aires)
 * and only appears in production. `test/jest-global-setup.ts` pins the suite to TZ=UTC to
 * reproduce the production host; the first test below guards that it really did.
 */
import {
  CLUB_TIMEZONE,
  dayLabelFromKey,
  dayRangeUtc,
  formatDayMonth,
  formatTime,
  formatTimeRange,
  shiftDateKey,
  toDateKey,
  wallTimeToUtc,
  weekdayOfKey,
} from './datetime'

describe('the test itself runs like production', () => {
  it('runs on a UTC host with the club in Buenos Aires (UTC-3)', () => {
    expect(CLUB_TIMEZONE).toBe('America/Argentina/Buenos_Aires')
    // If the process were in Buenos Aires, server-timezone bugs would pass unnoticed
    // and this whole file would be testing nothing.
    expect(new Date('2026-07-12T00:00:00Z').getHours()).toBe(0)
  })
})

describe('wallTimeToUtc', () => {
  it('reads "HH:MM" as the club\'s wall clock, not the server\'s', () => {
    // 09:00 in Buenos Aires is 12:00 UTC. A naive `new Date("2026-07-12T09:00")` on a UTC
    // host would yield 09:00Z — three hours early, the classic bug.
    expect(wallTimeToUtc('2026-07-12', '09:00').toISOString()).toBe('2026-07-12T12:00:00.000Z')
  })

  it('maps a late band past midnight UTC while staying the same club day', () => {
    // 22:30 local on the 12th = 01:30Z on the 13th.
    expect(wallTimeToUtc('2026-07-12', '22:30').toISOString()).toBe('2026-07-13T01:30:00.000Z')
  })

  it('round-trips: the instant it builds reads back as the same club day', () => {
    const instant = wallTimeToUtc('2026-07-12', '23:30')
    expect(toDateKey(instant)).toBe('2026-07-12')
    expect(formatTime(instant)).toBe('23:30')
  })
})

describe('toDateKey', () => {
  it('keeps a late-night instant on the club day it belongs to', () => {
    // 02:30Z on the 13th is still 23:30 of the 12th in Buenos Aires. Bucketing this
    // booking under the 13th would make it vanish from the club's agenda for the night.
    expect(toDateKey(new Date('2026-07-13T02:30:00Z'))).toBe('2026-07-12')
  })

  it('rolls over to the next club day at 03:00Z, not at midnight UTC', () => {
    expect(toDateKey(new Date('2026-07-13T02:59:59Z'))).toBe('2026-07-12')
    expect(toDateKey(new Date('2026-07-13T03:00:00Z'))).toBe('2026-07-13')
  })
})

describe('dayRangeUtc', () => {
  it('covers one club-local calendar day, shifted by the club offset', () => {
    const { gte, lt } = dayRangeUtc('2026-07-12')
    expect(gte.toISOString()).toBe('2026-07-12T03:00:00.000Z')
    expect(lt.toISOString()).toBe('2026-07-13T03:00:00.000Z')
  })

  it('is half-open, so a 23:30 slot lands in its own day and not the next', () => {
    const day = dayRangeUtc('2026-07-12')
    const lateSlot = wallTimeToUtc('2026-07-12', '23:30')
    expect(lateSlot >= day.gte && lateSlot < day.lt).toBe(true)

    const nextDay = dayRangeUtc('2026-07-13')
    expect(lateSlot < nextDay.gte).toBe(true)
    // No gap and no overlap between consecutive days.
    expect(day.lt.getTime()).toBe(nextDay.gte.getTime())
  })

  it('spans exactly 24 hours (Argentina has no DST)', () => {
    const { gte, lt } = dayRangeUtc('2026-07-12')
    expect(lt.getTime() - gte.getTime()).toBe(24 * 60 * 60 * 1000)
  })
})

describe('weekdayOfKey', () => {
  it('reads the club-local weekday (0 = Sunday)', () => {
    expect(weekdayOfKey('2026-07-12')).toBe(0) // domingo
    expect(weekdayOfKey('2026-07-13')).toBe(1) // lunes
    expect(weekdayOfKey('2026-07-18')).toBe(6) // sábado
  })

  it('never drifts to the adjacent day (the weeklyHours lookup depends on it)', () => {
    // Every key must report the weekday its own label says — a drift here would apply
    // Saturday's opening hours to Friday.
    for (const [key, expected] of [
      ['2026-01-01', 4],
      ['2026-03-01', 0],
      ['2026-12-31', 4],
    ] as const) {
      expect(weekdayOfKey(key)).toBe(expected)
    }
  })
})

describe('shiftDateKey', () => {
  it('walks calendar days across month and year boundaries', () => {
    expect(shiftDateKey('2026-07-31', 1)).toBe('2026-08-01')
    expect(shiftDateKey('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDateKey('2028-02-28', 1)).toBe('2028-02-29') // leap year
  })
})

describe('player-facing formatting', () => {
  it('formats the hour the player will read on their phone, not the server hour', () => {
    // The instant a 19:00–20:30 booking really is, stored in UTC.
    const startsAt = new Date('2026-07-12T22:00:00Z')
    const endsAt = new Date('2026-07-13T01:30:00Z')
    expect(formatTime(startsAt)).toBe('19:00')
    expect(formatTimeRange(startsAt, endsAt)).toBe('19:00–22:30')
  })

  it('formats the day the club calls it, even past midnight UTC', () => {
    expect(formatDayMonth(new Date('2026-07-13T02:00:00Z'))).toBe('12/07')
    expect(dayLabelFromKey('2026-07-12')).toBe('domingo 12/07')
  })
})
