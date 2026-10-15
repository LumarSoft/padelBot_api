import { PrismaService } from '../prisma/prisma.service'
import { CreditsService } from './credits.service'

interface Pack {
  id: string
  credits: number
  creditsUsed: number
  expiresAt: Date
}

/** A club on Saque (1.000 credits a month) that already sent `usedBefore` bot messages. */
function setup(opts: { usedBefore: number; packs?: Pack[]; plan?: string }) {
  let used = opts.usedBefore
  const packs = opts.packs ?? []
  const rows: Record<string, number>[] = []
  const prisma = {
    whatsAppLine: { findUnique: jest.fn().mockResolvedValue({ clubId: 'c1' }) },
    club: { findUnique: jest.fn().mockResolvedValue({ plan: opts.plan ?? 'saque' }) },
    whatsAppMessageDaily: {
      upsert: jest.fn(async ({ update }: { update: Record<string, unknown> }) => {
        if ('botService' in update || 'utility' in update) used++
        rows.push({ ...(update as Record<string, number>) })
        return {}
      }),
      aggregate: jest.fn(async () => ({ _sum: { botService: used, utility: 0, packCredits: 0 } })),
      update: jest.fn().mockResolvedValue({}),
    },
    creditPackPurchase: {
      findMany: jest.fn(async () => [...packs].sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())),
      updateMany: jest.fn(async ({ where }: { where: { id: string; creditsUsed: number } }) => {
        const pack = packs.find(p => p.id === where.id && p.creditsUsed === where.creditsUsed)
        if (!pack) return { count: 0 }
        pack.creditsUsed++
        return { count: 1 }
      }),
    },
  }
  return { prisma, packs, service: new CreditsService(prisma as unknown as PrismaService) }
}

const inMonths = (n: number) => new Date(Date.now() + n * 30 * 24 * 60 * 60 * 1000)

/**
 * A credit is a message the bot sends. Past the plan's monthly credits, each one is paid from the
 * club's soonest-expiring pack; without packs nothing happens to the bot (it's only counted).
 */
describe('CreditsService.recordSent', () => {
  it('counts a bot reply and leaves the packs alone while the plan has credits', async () => {
    const { prisma, packs, service } = setup({
      usedBefore: 10,
      packs: [{ id: 'p1', credits: 500, creditsUsed: 0, expiresAt: inMonths(5) }],
    })

    await service.recordSent('phone-1', 'botService')

    expect(prisma.whatsAppMessageDaily.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ clubId: 'c1', botService: 1 }) }),
    )
    expect(packs[0].creditsUsed).toBe(0)
  })

  it('pays a message past the plan from the pack that expires first', async () => {
    const { prisma, packs, service } = setup({
      usedBefore: 1_000,
      packs: [
        { id: 'late', credits: 500, creditsUsed: 0, expiresAt: inMonths(5) },
        { id: 'soon', credits: 500, creditsUsed: 0, expiresAt: inMonths(1) },
      ],
    })

    await service.recordSent('phone-1', 'utility')

    expect(packs.find(p => p.id === 'soon')!.creditsUsed).toBe(1)
    expect(packs.find(p => p.id === 'late')!.creditsUsed).toBe(0)
    expect(prisma.whatsAppMessageDaily.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { packCredits: { increment: 1 } } }),
    )
  })

  it('skips a pack with nothing left', async () => {
    const { packs, service } = setup({
      usedBefore: 1_200,
      packs: [
        { id: 'empty', credits: 500, creditsUsed: 500, expiresAt: inMonths(1) },
        { id: 'full', credits: 500, creditsUsed: 0, expiresAt: inMonths(5) },
      ],
    })

    await service.recordSent('phone-1', 'botService')

    expect(packs.find(p => p.id === 'full')!.creditsUsed).toBe(1)
  })

  it('never spends credits on a reply the staff typed', async () => {
    const { prisma, packs, service } = setup({
      usedBefore: 1_500,
      packs: [{ id: 'p1', credits: 500, creditsUsed: 0, expiresAt: inMonths(5) }],
    })

    await service.recordSent('phone-1', 'staffService')

    expect(prisma.whatsAppMessageDaily.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { staffService: { increment: 1 } } }),
    )
    expect(packs[0].creditsUsed).toBe(0)
  })

  it('never throws, even when the database is down', async () => {
    const { prisma, service } = setup({ usedBefore: 0 })
    prisma.whatsAppMessageDaily.upsert.mockRejectedValueOnce(new Error('db down'))

    await expect(service.recordSent('phone-1', 'botService')).resolves.toBeUndefined()
  })
})
