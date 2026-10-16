import { lastMonths, monthlyBusiness } from './ops-month-states.service'

const row = (clubId: string, month: string, status: 'ACTIVE' | 'TRIAL' | 'CANCELLED', mrrCents = 0) => ({
  clubId,
  month,
  clubName: clubId.toUpperCase(),
  subscriptionStatus: status,
  mrrCents,
})

describe('lastMonths', () => {
  it('walks back across a year', () => {
    expect(lastMonths('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02'])
  })
})

/**
 * Recurring revenue, clubs that started paying and churn come from each club's recorded state
 * per month; months before the recording started say "unknown" instead of zero.
 */
describe('monthlyBusiness', () => {
  const months = ['2026-08', '2026-09', '2026-10']

  it('counts revenue, new paying clubs and churn month over month', () => {
    const series = monthlyBusiness(
      months,
      [
        row('a', '2026-09', 'ACTIVE', 5_000_000),
        row('b', '2026-09', 'ACTIVE', 8_000_000),
        row('a', '2026-10', 'ACTIVE', 5_000_000),
        row('b', '2026-10', 'CANCELLED'),
        row('c', '2026-10', 'ACTIVE', 13_000_000),
      ],
      ['2026-09', '2026-10', '2026-10'],
    )

    expect(series[0]).toMatchObject({ month: '2026-08', tracked: false, mrrCents: null, newClubs: 0 })
    // September is the first tracked month: nothing to compare with.
    expect(series[1]).toMatchObject({ tracked: true, mrrCents: 13_000_000, paying: 2, newPaying: null, churned: null })
    expect(series[2]).toMatchObject({
      mrrCents: 18_000_000,
      paying: 2,
      newPaying: 1,
      churned: 1,
      churnedClubs: ['B'],
      newClubs: 2,
    })
  })

  it('counts a club that vanished from one month to the next as churn', () => {
    const series = monthlyBusiness(['2026-10'], [row('a', '2026-09', 'ACTIVE', 1), row('b', '2026-10', 'TRIAL')], [])
    expect(series[0]).toMatchObject({ churned: 1, churnedClubs: ['A'], paying: 0 })
  })
})
