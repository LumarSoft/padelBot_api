import { ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { PlansService } from './plans.service'

function setup(opts: { plan: string; courts?: number; activeUsers?: number; credits?: number }) {
  const prisma = {
    club: { findUnique: jest.fn().mockResolvedValue({ plan: opts.plan }) },
    court: { count: jest.fn().mockResolvedValue(opts.courts ?? 0) },
    user: { count: jest.fn().mockResolvedValue(opts.activeUsers ?? 1) },
    llmUsageDaily: { aggregate: jest.fn().mockResolvedValue({ _sum: { calls: opts.credits ?? null } }) },
  }
  return { prisma, service: new PlansService(prisma as unknown as PrismaService) }
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
    expect(overview.aiCredits).toMatchObject({ used: 0, limit: 3_000, percent: 0 })
  })

  it('reports AI credits past the allowance as they are', async () => {
    const { service } = setup({ plan: 'saque', credits: 1_250 })

    const overview = await service.overview('club-1')

    expect(overview.aiCredits).toMatchObject({ used: 1_250, limit: 1_000, percent: 125 })
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

describe('PlansService AI credits', () => {
  it('sums the calendar month of the club-local day', async () => {
    const aggregate = jest.fn().mockResolvedValue({ _sum: { calls: 640 } })
    const service = new PlansService({ llmUsageDaily: { aggregate } } as unknown as PrismaService)

    await expect(service.aiCreditsUsed('club-1', '2026-10-14')).resolves.toBe(640)
    expect(aggregate).toHaveBeenCalledWith({
      where: { clubId: 'club-1', dateKey: { gte: '2026-10-01', lte: '2026-10-14' } },
      _sum: { calls: true },
    })
  })
})
