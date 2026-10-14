import { ForbiddenException } from '@nestjs/common'
import { BookingsService } from '../bookings/bookings.service'
import { noAvailabilityWithSuggestions } from '../bot/messages'
import { ClubsService } from '../clubs/clubs.service'
import { CourtsService } from '../courts/courts.service'
import { PrismaService } from '../prisma/prisma.service'
import { PlansService } from './plans.service'

/** A real PlansService over a club row: Saque, Bandeja, or a club that predates the plans. */
function plansFor(club: { plan: string; grandfatheredFeatures: boolean }) {
  const prisma = { club: { findUnique: jest.fn().mockResolvedValue(club) } }
  return new PlansService(prisma as unknown as PrismaService)
}

const NEW_SAQUE = { plan: 'saque', grandfatheredFeatures: false }
const OLD_SAQUE = { plan: 'saque', grandfatheredFeatures: true }
const BANDEJA = { plan: 'bandeja', grandfatheredFeatures: false }

/**
 * The Bandeja modules are refused only when a club tries to turn one ON on a plan without it.
 * Clubs that existed before the plans keep everything (`grandfatheredFeatures`), and whatever a
 * club already has running keeps working — nobody loses a feature silently.
 */
describe('PlansService modules', () => {
  it('refuses a Bandeja module on a new Saque club, naming the plan', async () => {
    await expect(plansFor(NEW_SAQUE).assertFeature('c1', 'fixedConfirmation')).rejects.toThrow(
      /confirmación de fijos.*plan Bandeja/,
    )
  })

  it('lets Bandeja, a club that predates the plans and an unknown plan use every module', async () => {
    for (const club of [BANDEJA, OLD_SAQUE, { plan: 'base', grandfatheredFeatures: false }]) {
      await expect(plansFor(club).assertFeature('c1', 'splitPayment')).resolves.toBeUndefined()
    }
  })

  it('lists each module with the plan that includes it in the overview', async () => {
    const prisma = {
      club: { findUnique: jest.fn().mockResolvedValue(NEW_SAQUE) },
      court: { count: jest.fn().mockResolvedValue(1) },
      user: { count: jest.fn().mockResolvedValue(1) },
      llmUsageDaily: { aggregate: jest.fn().mockResolvedValue({ _sum: { calls: 0 } }) },
    }
    const overview = await new PlansService(prisma as unknown as PrismaService).overview('c1')

    expect(overview.features.kioscoStock).toEqual({ enabled: false, plan: 'Bandeja' })
    expect(overview.features.waitlist.enabled).toBe(false)
    expect(overview.grandfatheredFeatures).toBe(false)
  })
})

describe('fijo confirmation and the plan', () => {
  function setup(club: { plan: string; grandfatheredFeatures: boolean }, enabled: boolean) {
    const prisma = {
      club: {
        findUnique: jest.fn(async ({ select }: { select: Record<string, boolean> }) =>
          'fixedConfirmationEnabled' in select
            ? { fixedConfirmationEnabled: enabled, fixedConfirmationLeadHours: 24 }
            : club,
        ),
        update: jest.fn().mockResolvedValue({}),
      },
    }
    const plans = new PlansService(prisma as unknown as PrismaService)
    return { prisma, service: new ClubsService(prisma as never, {} as never, {} as never, plans) }
  }

  it('refuses turning it on for a new Saque club', async () => {
    const { prisma, service } = setup(NEW_SAQUE, false)

    await expect(service.updateFixedConfirmation('c1', { enabled: true })).rejects.toThrow(ForbiddenException)
    expect(prisma.club.update).not.toHaveBeenCalled()
  })

  it('keeps it (and lets the owner tune or turn it off) when it was already on', async () => {
    const { prisma, service } = setup(NEW_SAQUE, true)

    await service.updateFixedConfirmation('c1', { enabled: true, leadHours: 12 })
    await service.updateFixedConfirmation('c1', { enabled: false })

    expect(prisma.club.update).toHaveBeenCalledTimes(2)
  })

  it('turns it on for a club that predates the plans', async () => {
    const { prisma, service } = setup(OLD_SAQUE, false)

    await service.updateFixedConfirmation('c1', { enabled: true })

    expect(prisma.club.update).toHaveBeenCalled()
  })
})

describe('scheduled price rises and the plan', () => {
  it('refuses scheduling one on a new Saque club but leaves the dry run alone', async () => {
    const prisma = {
      club: { findUnique: jest.fn().mockResolvedValue(NEW_SAQUE) },
      scheduledPriceAdjustment: { create: jest.fn() },
      court: { findMany: jest.fn().mockResolvedValue([]) },
      courtPriceRule: { findMany: jest.fn().mockResolvedValue([]) },
      recurringBooking: { findMany: jest.fn().mockResolvedValue([]) },
    }
    const service = new CourtsService(prisma as never, {} as never, plansFor(NEW_SAQUE))

    await expect(service.bulkAdjustPrices('c1', { percent: 10, effectiveDate: '2099-01-01' })).rejects.toThrow(
      /Programar aumentos.*Bandeja/,
    )
    expect(prisma.scheduledPriceAdjustment.create).not.toHaveBeenCalled()
    await expect(
      service.bulkAdjustPrices('c1', { percent: 10, effectiveDate: '2099-01-01', dryRun: true }),
    ).resolves.toMatchObject({ applied: false })
  })
})

describe('split payment and the plan', () => {
  it('refuses charging a player their share on a new Saque club', async () => {
    const prisma = { bookingPlayerPayment: { create: jest.fn() }, booking: { findFirst: jest.fn() } }
    const bookings = new BookingsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      plansFor(NEW_SAQUE),
    )

    await expect(
      bookings.addPlayerPayment('c1', 'b1', { playerSlot: 1, amountCents: 500_000, method: 'CASH' } as never),
    ).rejects.toThrow(/cobro dividido.*Bandeja/)
    expect(prisma.bookingPlayerPayment.create).not.toHaveBeenCalled()
  })
})

describe('the waitlist offer', () => {
  it('drops "avisame" from a full day when the plan has no waitlist', () => {
    expect(noAvailabilityWithSuggestions('2026-10-17', [])).toContain('avisame')
    expect(noAvailabilityWithSuggestions('2026-10-17', [], false)).not.toContain('avisame')
    const withDays = noAvailabilityWithSuggestions('2026-10-17', [{ dateKey: '2026-10-18', count: 3 }], false)
    expect(withDays).toContain('turnos libres')
    expect(withDays).not.toContain('avisame')
  })
})
