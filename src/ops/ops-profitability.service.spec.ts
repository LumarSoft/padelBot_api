import { PrismaService } from '../prisma/prisma.service'
import { margin, messageCost, usdToArsCents } from './lib/profitability'
import { OpsProfitabilityService } from './ops-profitability.service'

describe('messageCost', () => {
  it('bills service messages only past 1.000 per number, and every template', () => {
    expect(messageCost([{ botService: 900, staffService: 300, utility: 50 }])).toEqual({
      total: 1_250,
      free: 1_000,
      paid: 250,
    })
  })

  it('gives each number its own free tier', () => {
    expect(
      messageCost([
        { botService: 800, staffService: 0, utility: 0 },
        { botService: 800, staffService: 0, utility: 0 },
      ]),
    ).toEqual({ total: 1_600, free: 1_600, paid: 0 })
  })
})

describe('margin', () => {
  it('flags a loss, a thin margin and a club that pays nothing yet', () => {
    expect(margin({ revenueCents: 1_000_00, costCents: 1_200_00 })).toMatchObject({ flag: 'negative' })
    expect(margin({ revenueCents: 1_000_00, costCents: 800_00 })).toMatchObject({ marginPercent: 20, flag: 'low' })
    expect(margin({ revenueCents: 1_000_00, costCents: 100_00 })).toMatchObject({ marginPercent: 90, flag: null })
    expect(margin({ revenueCents: 0, costCents: 500_00 })).toMatchObject({ marginPercent: null, flag: 'noRevenue' })
  })

  it('converts dollars to whole pesos', () => {
    expect(usdToArsCents(6.5, 1500)).toBe(975_000)
  })
})

describe('OpsProfitabilityService.report', () => {
  const env = { ...process.env }
  beforeEach(() => {
    process.env.PLAN_PRICE_SAQUE_CENTS = '4999900'
    process.env.META_MESSAGE_PRICE_USD = '0.026'
    process.env.USD_ARS_RATE = '1000'
  })
  afterEach(() => {
    process.env = { ...env }
  })

  function setup() {
    const prisma = {
      club: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'c1', name: 'Padel Norte', slug: 'padel-norte', plan: 'saque', subscriptionStatus: 'ACTIVE' },
          { id: 'c2', name: 'Nuevo Club', slug: 'nuevo', plan: 'saque', subscriptionStatus: 'TRIAL' },
          { id: 'demo', name: 'Distrito Pádel', slug: 'distrito-padel', plan: 'bandeja', subscriptionStatus: 'ACTIVE' },
        ]),
      },
      whatsAppMessageDaily: {
        groupBy: jest.fn().mockResolvedValue([
          { clubId: 'c1', phoneNumberId: 'n1', _sum: { botService: 1_400, staffService: 100, utility: 100 } },
          { clubId: 'c2', phoneNumberId: 'n2', _sum: { botService: 200, staffService: 0, utility: 20 } },
          { clubId: 'demo', phoneNumberId: 'n3', _sum: { botService: 5_000, staffService: 0, utility: 0 } },
        ]),
      },
      llmUsageDaily: { groupBy: jest.fn().mockResolvedValue([{ clubId: 'c1', _sum: { costMicroUsd: 2_000_000 } }]) },
      creditPackPurchase: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ clubId: 'c1', priceCents: 8_999_900, approvedAt: new Date('2026-10-12T15:00:00Z') }]),
      },
    }
    return new OpsProfitabilityService(prisma as unknown as PrismaService)
  }

  it('adds plan and packs, costs Meta and OpenAI in pesos, and leaves the demo out of the totals', async () => {
    const report = await setup().report('2026-10')
    const norte = report.clubs.find(c => c.id === 'c1')!

    // 1.500 service messages (500 past the free tier) + 100 templates = 600 billed × US$0,026 × $1.000.
    expect(norte.messages).toEqual({ total: 1_600, free: 1_000, paid: 600 })
    expect(norte.cost.metaCents).toBe(15_600_00)
    expect(norte.cost.aiCents).toBe(2_000_00)
    expect(norte.revenue).toEqual({ planCents: 4_999_900, packsCents: 8_999_900, totalCents: 13_999_800 })
    expect(norte.credits).toEqual({ used: 1_500, included: 1_000 })

    const trial = report.clubs.find(c => c.id === 'c2')!
    expect(trial.revenue.totalCents).toBe(0)
    // Its replies fit the free tier, but templates are always billed: a cost with no revenue yet.
    expect(trial.messages.paid).toBe(20)
    expect(trial.flag).toBe('noRevenue')

    expect(report.totals.revenueCents).toBe(13_999_800)
    expect(report.totals.messages.total).toBe(1_820)
    expect(report.clubs.find(c => c.id === 'demo')!.isDemo).toBe(true)
  })
})
