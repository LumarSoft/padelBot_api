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
      aggregate: jest.fn().mockResolvedValue({ _sum: { botService: used, utility: 0 } }),
    },
  }
  const db = prisma as unknown as PrismaService
  return { prisma, user, service: new PlansService(db, new CreditsService(db)) }
}

describe('creditsNoticeLevel', () => {
  it('speaks up with 20%, 10% and 5% left, and when the plan credits run out', () => {
    expect(creditsNoticeLevel(790, 1_000)).toBeNull()
    expect(creditsNoticeLevel(800, 1_000)).toBe(80)
    expect(creditsNoticeLevel(900, 1_000)).toBe(90)
    expect(creditsNoticeLevel(950, 1_000)).toBe(95)
    expect(creditsNoticeLevel(1_000, 1_000)).toBe(100)
    expect(creditsNoticeLevel(5_000, null)).toBeNull()
  })
})

/**
 * The "te quedan pocos créditos" banner can be closed, and comes back at each lower level left
 * (10%, 5%). Once the credits run out the bot is paused and the banner can't be closed.
 * Facturación always shows it.
 */
describe('the credits notice', () => {
  it('shows at 85% until the user closes it', async () => {
    const { service } = setup(850)
    expect((await service.overview('c1', 7)).creditsNotice).toEqual({ level: 80, dismissed: false })

    await service.dismissCreditsNotice('c1', 7)

    expect((await service.overview('c1', 7)).creditsNotice).toEqual({ level: 80, dismissed: true })
  })

  it('comes back when 10% is left', async () => {
    const month = monthKeyOf(todayKey())
    const { service } = setup(920, `${month}:80`)
    expect((await service.overview('c1', 7)).creditsNotice).toEqual({ level: 90, dismissed: false })
  })

  it('stays up while the bot is paused, even if closed', async () => {
    const month = monthKeyOf(todayKey())
    const { prisma, service } = setup(1_000, `${month}:100`)
    const overview = await service.overview('c1', 7)
    expect(overview.creditsNotice).toEqual({ level: 100, dismissed: false })
    expect(overview.aiCredits.paused).toBe(true)

    await service.dismissCreditsNotice('c1', 7)
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })

  it('does nothing to dismiss when there is no notice', async () => {
    const { prisma, service } = setup(100)
    await service.dismissCreditsNotice('c1', 7)
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })
})
