import { ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreditsService } from './credits.service'
import { PlansService } from './plans.service'

function setup(opts: {
  plan: string
  courts?: number
  activeUsers?: number
  credits?: number
  packs?: { credits: number; creditsUsed: number }[]
}) {
  const prisma = {
    club: { findUnique: jest.fn().mockResolvedValue({ plan: opts.plan }) },
    court: { count: jest.fn().mockResolvedValue(opts.courts ?? 0) },
    user: { count: jest.fn().mockResolvedValue(opts.activeUsers ?? 1) },
    whatsAppMessageDaily: {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { botService: opts.credits ?? null, utility: null, packCredits: null } }),
    },
    creditPackPurchase: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          (opts.packs ?? []).map((p, i) => ({ id: `p${i}`, ...p, expiresAt: new Date('2027-04-01T00:00:00Z') })),
        ),
    },
  }
  const db = prisma as unknown as PrismaService
  return { prisma, service: new PlansService(db, new CreditsService(db)) }
}

/**
 * Courts are a soft limit: the plan refuses the one that doesn't fit and names the plan with
 * room, while a club already over it (moved down a plan) keeps every court it has.
 */
describe('PlansService.assertCanAddCourt', () => {
  it('lets Saque reach its second court', async () => {
    const { service } = setup({ plan: 'saque', courts: 1 })
    await expect(service.assertCanAddCourt('club-1')).resolves.toBeUndefined()
  })

  it('refuses the third court on Saque and points to Bandeja', async () => {
    const { service } = setup({ plan: 'saque', courts: 2 })
    await expect(service.assertCanAddCourt('club-1')).rejects.toThrow(ForbiddenException)
    await expect(service.assertCanAddCourt('club-1')).rejects.toThrow(/hasta 2 canchas.*pasate a Bandeja/)
  })

  it('points a full Bandeja to Smash', async () => {
    const { service } = setup({ plan: 'bandeja', courts: 4 })
    await expect(service.assertCanAddCourt('club-1')).rejects.toThrow(/pasate a Smash/)
  })

  it('still refuses (and does not complain) for a club already over the limit', async () => {
    const { service } = setup({ plan: 'saque', courts: 6 })
    await expect(service.assertCanAddCourt('club-1')).rejects.toThrow(/ya tenés 6/)
  })

  it('never limits Smash or an unknown plan key', async () => {
    for (const plan of ['smash', 'base']) {
      const { service } = setup({ plan, courts: 30 })
      await expect(service.assertCanAddCourt('club-1')).resolves.toBeUndefined()
    }
  })
})

describe('PlansService.overview', () => {
  it('reports the limits and how much of them is used', async () => {
    const { service } = setup({ plan: 'bandeja', courts: 3, activeUsers: 5 })

    const overview = await service.overview('club-1')

    expect(overview.plan).toEqual({ key: 'bandeja', name: 'Bandeja', known: true })
    expect(overview.courts).toEqual({ used: 3, limit: 4 })
    expect(overview.users).toEqual({ used: 5, limit: 5 })
    expect(overview.aiCredits).toMatchObject({ used: 0, limit: 2_000, percent: 0 })
  })

  it('reports AI credits past the allowance as they are', async () => {
    const { service } = setup({ plan: 'saque', credits: 1_250 })

    const overview = await service.overview('club-1')

    expect(overview.aiCredits).toMatchObject({ used: 1_250, limit: 1_000, percent: 125 })
  })

  it('adds the credit packs left to the total the panel shows', async () => {
    const { service } = setup({
      plan: 'bandeja',
      credits: 1_500,
      packs: [
        { credits: 1_000, creditsUsed: 200 },
        { credits: 500, creditsUsed: 500 },
      ],
    })

    const overview = await service.overview('club-1')

    expect(overview.aiCredits).toMatchObject({ used: 1_500, limit: 2_000, extraBalance: 800, available: 2_800 })
  })

  it('shows an unknown key as it is stored, with no limits', async () => {
    const { service } = setup({ plan: 'pro', courts: 3 })

    const overview = await service.overview('club-1')

    expect(overview.plan).toEqual({ key: 'pro', name: 'pro', known: false })
    expect(overview.courts.limit).toBeNull()
    expect(overview.users.limit).toBeNull()
    expect(overview.aiCredits.limit).toBeNull()
    expect(overview.aiCredits.percent).toBeNull()
  })
})
