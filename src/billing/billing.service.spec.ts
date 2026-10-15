import { NotFoundException } from '@nestjs/common'
import { BillingService } from './billing.service'

const PERIOD_END = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000)
const ACTIVE = { subscriptionStatus: 'ACTIVE', plan: 'saque', trialEndsAt: null, currentPeriodEnd: PERIOD_END }

function setup(club: object | null = ACTIVE, used = 850) {
  const prisma = { club: { findUnique: jest.fn().mockResolvedValue(club) } }
  const credits = { monthUsed: jest.fn().mockResolvedValue(used) }
  return new BillingService(prisma as never, credits as never)
}

describe('BillingService.overview', () => {
  it('shows the plan, when it renews and the month credits against the plan', async () => {
    const overview = await setup().overview('c1')

    expect(overview.plan).toEqual({ key: 'saque', name: 'Saque', known: true })
    expect(overview.subscription).toEqual({ status: 'ACTIVE', severity: 'ok', renewsAt: PERIOD_END })
    expect(overview.credits).toMatchObject({ used: 850, included: 1_000, percent: 85 })
  })

  it('dates a trial by its end and leaves an unknown plan without credits', async () => {
    const trialEndsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    const overview = await setup({ ...ACTIVE, subscriptionStatus: 'TRIAL', plan: 'pro', trialEndsAt }).overview('c1')

    expect(overview.subscription.renewsAt).toEqual(trialEndsAt)
    expect(overview.credits).toMatchObject({ included: null, percent: null })
  })

  it('refuses a club that does not exist', async () => {
    await expect(setup(null).overview('c1')).rejects.toThrow(NotFoundException)
  })
})
