import { CourtSchedule } from '../../availability/lib/schedule'
import { bandsOverlapping, sessionWindow } from './blocks'

// CLUB_TIMEZONE defaults to America/Argentina/Buenos_Aires (UTC-3, no DST); tests run in UTC.
function court(overrides: Partial<CourtSchedule> = {}): CourtSchedule {
  return { openTime: '09:00', closeTime: '00:00', slotDurationMinutes: 90, weeklyHours: null, ...overrides }
}

describe('sessionWindow', () => {
  it('converts the wall-clock window to UTC', () => {
    expect(sessionWindow({ dateKey: '2026-10-17', startTime: '20:00', endTime: '23:00' })).toEqual({
      startsAt: new Date('2026-10-17T23:00:00Z'),
      endsAt: new Date('2026-10-18T02:00:00Z'),
    })
  })

  it('ends on the next day when the end is at or before the start', () => {
    expect(sessionWindow({ dateKey: '2026-10-17', startTime: '21:00', endTime: '01:00' }).endsAt).toEqual(
      new Date('2026-10-18T04:00:00Z'),
    )
  })

  it('refuses equal or malformed times', () => {
    expect(() => sessionWindow({ dateKey: '2026-10-17', startTime: '20:00', endTime: '20:00' })).toThrow()
    expect(() => sessionWindow({ dateKey: '2026-10-17', startTime: '8:00', endTime: '20:00' })).toThrow()
  })
})

describe('bandsOverlapping', () => {
  it('takes every band that touches the window, partial ones included', () => {
    // Bands from 09:00 every 90': … 18:00, 19:30, 21:00, 22:30 (ends 00:00).
    const window = sessionWindow({ dateKey: '2026-10-17', startTime: '20:00', endTime: '23:00' })
    const bands = bandsOverlapping(court(), window)
    expect(bands.map(b => b.startsAt.toISOString())).toEqual([
      '2026-10-17T22:30:00.000Z', // 19:30
      '2026-10-18T00:00:00.000Z', // 21:00
      '2026-10-18T01:30:00.000Z', // 22:30
    ])
  })

  it('reaches past midnight bands of a court that closes late', () => {
    const window = sessionWindow({ dateKey: '2026-10-17', startTime: '22:00', endTime: '01:00' })
    const bands = bandsOverlapping(court({ openTime: '18:00', closeTime: '03:00', slotDurationMinutes: 60 }), window)
    expect(bands).toHaveLength(3) // 22:00, 23:00, 00:00
  })

  it('takes nothing on a day the court is closed', () => {
    const window = sessionWindow({ dateKey: '2026-10-18', startTime: '10:00', endTime: '12:00' }) // Sunday
    expect(bandsOverlapping(court({ weeklyHours: { '0': null } }), window)).toEqual([])
  })
})
