import { creditPercent, creditsPaused, crossedAlertPercent, monthName, monthStartKey } from './ai-credits'

describe('AI credit thresholds', () => {
  it('stays quiet below 80%', () => {
    expect(crossedAlertPercent(799, 1_000)).toBeNull()
  })

  it('alerts with 20%, 10% and 5% left, and when the credits run out', () => {
    expect(crossedAlertPercent(800, 1_000)).toBe(80)
    expect(crossedAlertPercent(899, 1_000)).toBe(80)
    expect(crossedAlertPercent(900, 1_000)).toBe(90)
    expect(crossedAlertPercent(950, 1_000)).toBe(95)
    expect(crossedAlertPercent(999, 1_000)).toBe(95)
    expect(crossedAlertPercent(1_000, 1_000)).toBe(100)
    expect(crossedAlertPercent(4_000, 1_000)).toBe(100)
  })

  it('pauses the bot once the plan credits are used up, never for the demo or an unknown plan', () => {
    expect(creditsPaused(999, 1_000)).toBe(false)
    expect(creditsPaused(1_000, 1_000)).toBe(true)
    expect(creditsPaused(5_000, 1_000, true)).toBe(false)
    expect(creditsPaused(5_000, null)).toBe(false)
  })

  it('has nothing to say without an allowance (unknown plan)', () => {
    expect(creditPercent(5_000, null)).toBeNull()
    expect(crossedAlertPercent(5_000, null)).toBeNull()
  })

  it('reports usage past 100% as it is', () => {
    expect(creditPercent(3_450, 3_000)).toBe(115)
  })
})

describe('the monthly allowance', () => {
  it('resets on the club-local calendar month', () => {
    expect(monthStartKey('2026-10-14')).toBe('2026-10-01')
    expect(monthName('2026-10')).toBe('octubre')
  })
})
