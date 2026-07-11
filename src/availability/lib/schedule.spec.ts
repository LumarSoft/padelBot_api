import {
  bandDateTimes,
  bandsForDate,
  bandsForWeekday,
  bandSortMinutes,
  generateBands,
  hoursForWeekday,
  parseWeeklyHours,
  CourtSchedule,
} from './schedule'

// CLUB_TIMEZONE defaults to America/Argentina/Buenos_Aires (UTC-3, no DST).
const ART_OFFSET_MS = 3 * 60 * 60 * 1000

function court(overrides: Partial<CourtSchedule> = {}): CourtSchedule {
  return { openTime: '09:00', closeTime: '00:00', slotDurationMinutes: 90, weeklyHours: null, ...overrides }
}

describe('generateBands', () => {
  it('generates the classic 90-minute padel grid from 09:00 to midnight', () => {
    const bands = generateBands('09:00', '00:00', 90)
    expect(bands).toHaveLength(10)
    expect(bands[0]).toEqual({ start: '09:00', end: '10:30', startOffset: 0, endOffset: 0 })
    expect(bands[9]).toEqual({ start: '22:30', end: '00:00', startOffset: 0, endOffset: 1 })
  })

  it('supports 60-minute bands', () => {
    const bands = generateBands('08:00', '12:00', 60)
    expect(bands.map(b => b.start)).toEqual(['08:00', '09:00', '10:00', '11:00'])
    expect(bands.every(b => b.startOffset === 0 && b.endOffset === 0)).toBe(true)
  })

  it('supports 120-minute bands and drops a leftover partial band', () => {
    const bands = generateBands('09:00', '14:00', 120)
    expect(bands.map(b => `${b.start}-${b.end}`)).toEqual(['09:00-11:00', '11:00-13:00'])
  })

  it('crosses midnight when close ≤ open ("viernes hasta la 1 AM")', () => {
    const bands = generateBands('22:00', '01:00', 90)
    expect(bands).toEqual([
      { start: '22:00', end: '23:30', startOffset: 0, endOffset: 0 },
      { start: '23:30', end: '01:00', startOffset: 0, endOffset: 1 },
    ])
  })

  it('can start a band past midnight', () => {
    const bands = generateBands('21:00', '02:00', 60)
    expect(bands.map(b => `${b.start}(${b.startOffset})`)).toEqual([
      '21:00(0)',
      '22:00(0)',
      '23:00(0)',
      '00:00(1)',
      '01:00(1)',
    ])
  })
})

describe('bandDateTimes', () => {
  it('maps a same-day band to club-local instants', () => {
    const { startsAt, endsAt } = bandDateTimes('2026-07-10', {
      start: '18:00',
      end: '19:30',
      startOffset: 0,
      endOffset: 0,
    })
    expect(startsAt.toISOString()).toBe(new Date(Date.UTC(2026, 6, 10, 18, 0) + ART_OFFSET_MS).toISOString())
    expect(endsAt.getTime() - startsAt.getTime()).toBe(90 * 60 * 1000)
  })

  it('places a past-midnight band on the following calendar day', () => {
    const { startsAt, endsAt } = bandDateTimes('2026-07-10', {
      start: '23:30',
      end: '01:00',
      startOffset: 0,
      endOffset: 1,
    })
    expect(endsAt.getTime() - startsAt.getTime()).toBe(90 * 60 * 1000)
    // End = July 11 01:00 ART = July 11 04:00 UTC.
    expect(endsAt.toISOString()).toBe('2026-07-11T04:00:00.000Z')
  })
})

describe('weekly hours', () => {
  const weekly = {
    '5': { open: '10:00', close: '01:00' }, // Friday until 1 AM (10:00 + 90' bands aligns at 01:00)
    '0': null, // closed on Sunday
  }

  it('parses a valid shape and rejects invalid ones', () => {
    expect(parseWeeklyHours(weekly)).toEqual(weekly)
    expect(parseWeeklyHours(null)).toBeNull()
    expect(() => parseWeeklyHours({ '7': { open: '09:00', close: '10:00' } })).toThrow(/día inválido/)
    expect(() => parseWeeklyHours({ '1': { open: '9am', close: '22:00' } })).toThrow(/horario inválido/)
    expect(() => parseWeeklyHours({ '1': { open: '10:00', close: '10:00' } })).toThrow(/no pueden coincidir/)
    expect(() => parseWeeklyHours('x')).toThrow()
  })

  it('falls back to the court default when a weekday has no override', () => {
    const c = court({ weeklyHours: weekly })
    expect(hoursForWeekday(c, 2)).toEqual({ open: '09:00', close: '00:00' })
    expect(hoursForWeekday(c, 5)).toEqual({ open: '10:00', close: '01:00' })
    expect(hoursForWeekday(c, 0)).toBeNull()
  })

  it('bandsForDate resolves the weekday from the club-local date key', () => {
    const c = court({ weeklyHours: weekly })
    // 2026-07-10 is a Friday, 2026-07-12 a Sunday.
    const friday = bandsForDate(c, '2026-07-10')
    expect(friday[friday.length - 1]).toEqual({ start: '23:30', end: '01:00', startOffset: 0, endOffset: 1 })
    expect(bandsForDate(c, '2026-07-12')).toEqual([])
    expect(bandsForWeekday(c, 5)).toEqual(friday)
  })
})

describe('bandSortMinutes', () => {
  it('sorts past-midnight bands after evening bands', () => {
    const evening = { start: '23:30', end: '01:00', startOffset: 0, endOffset: 1 }
    const lateNight = { start: '00:30', end: '02:00', startOffset: 1, endOffset: 1 }
    expect(bandSortMinutes(lateNight)).toBeGreaterThan(bandSortMinutes(evening))
  })
})
