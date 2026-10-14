import { creditPercent, crossedAlertPercent, monthName, monthStartKey } from './ai-credits'

describe('AI credit thresholds', () => {
  it('stays quiet below 80%', () => {
    expect(crossedAlertPercent(799, 1_000)).toBeNull()
  })

  it('alerts at 80% and at 100% of the allowance, never in between twice', () => {
    expect(crossedAlertPercent(800, 1_000)).toBe(80)
    expect(crossedAlertPercent(999, 1_000)).toBe(80)
    expect(crossedAlertPercent(1_000, 1_000)).toBe(100)
    expect(crossedAlertPercent(4_000, 1_000)).toBe(100)
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
