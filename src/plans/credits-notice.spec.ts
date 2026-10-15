import { PrismaService } from '../prisma/prisma.service'
import { CreditsService } from './credits.service'
import { todayKey } from '../availability/lib/datetime'
import { creditsNoticeLevel, monthKeyOf } from './lib/ai-credits'
import { PlansService } from './plans.service'

/** A Saque club (1.000 credits) that sent `used` bot messages, seen by a user who closed `dismissed`. */
function setup(used: number, dismissed: string | null = null) {
  const user = { creditsNoticeDismissed: dismissed }
  const prisma = {
    club: { findUnique: jest.fn().mockResolvedValue({ plan: 'saque', grandfatheredFeatures: false }) },
    court: { count: jest.fn().mockResolvedValue(1) },
    user: {
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn(async () => user),
      updateMany: jest.fn(async ({ data }: { data: { creditsNoticeDismissed: string } }) => {
        user.creditsNoticeDismissed = data.creditsNoticeDismissed
        return { count: 1 }
      }),
    },
    whatsAppMessageDaily: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { botService: used, utility: 0, packCredits: 0 } }),
    },
    creditPackPurchase: { findMany: jest.fn().mockResolvedValue([]) },
  }
  const db = prisma as unknown as PrismaService
  return { prisma, user, service: new PlansService(db, new CreditsService(db)) }
}

describe('creditsNoticeLevel', () => {
  it('speaks up at 80% and at 100% of plan + pack credits', () => {
    expect(creditsNoticeLevel(790, 1_000)).toBeNull()
    expect(creditsNoticeLevel(800, 1_000)).toBe(80)
    expect(creditsNoticeLevel(1_000, 1_000)).toBe(100)
    expect(creditsNoticeLevel(5_000, null)).toBeNull()
  })
})

/**
 * The owner can close the "te quedan pocos créditos" banner and it doesn't come back that month —
 * except once, when the credits actually run out. Facturación always shows it.
 */
describe('the credits notice', () => {
  it('shows at 85% until the user closes it', async () => {
    const { service } = setup(850)
    expect((await service.overview('c1', 7)).creditsNotice).toEqual({ level: 80, dismissed: false })

    await service.dismissCreditsNotice('c1', 7)

    expect((await service.overview('c1', 7)).creditsNotice).toEqual({ level: 80, dismissed: true })
  })

  it('comes back once when the credits run out', async () => {
    const month = monthKeyOf(todayKey())
    const { service } = setup(1_000, `${month}:80`)
    expect((await service.overview('c1', 7)).creditsNotice).toEqual({ level: 100, dismissed: false })
  })

  it('does nothing to dismiss when there is no notice', async () => {
    const { prisma, service } = setup(100)
    await service.dismissCreditsNotice('c1', 7)
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })
})
