import { SlotPricingService } from './slot-pricing.service'

/**
 * Which turnos follow a price change and which keep the price they were sold at. Getting this
 * wrong either leaves the agenda quoting last month's prices (the club loses money quietly) or
 * moves the price of a turno the player already paid a seña for (the club has to explain it).
 *
 * Prisma is mocked at the query level; each test states what the DB "contains".
 */

type MockFn = jest.Mock

interface PrismaMock {
  court: { findMany: MockFn }
  slot: { findMany: MockFn; findFirst: MockFn; update: MockFn }
}

/** A future Tuesday 20:00 in Buenos Aires (UTC-3) — the band the price rules below target. */
const TUESDAY_20 = new Date('2099-01-06T23:00:00.000Z')

function prismaMock(): PrismaMock {
  return {
    court: { findMany: jest.fn() },
    slot: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
  }
}

function makeService(prisma: PrismaMock): SlotPricingService {
  return new SlotPricingService(prisma as never)
}

/** A booking with no money in it and no live quote — e.g. one loaded from the panel. */
function unpaidBooking(overrides: Record<string, unknown> = {}) {
  return {
    status: 'CONFIRMED',
    transferAmountCents: null,
    creditAppliedCents: 0,
    localPaymentCents: 0,
    playerPayments: [],
    recurringBooking: null,
    ...overrides,
  }
}

describe('SlotPricingService.repriceFutureSlots', () => {
  const court = {
    id: 'court-1',
    priceCents: 30_000,
    priceRules: [{ dayOfWeek: 2, startTime: '20:00', priceCents: 40_000 }],
  }

  function setup(bookings: ReturnType<typeof unpaidBooking>[], slotPriceCents = 20_000) {
    const prisma = prismaMock()
    prisma.court.findMany.mockResolvedValue([court])
    prisma.slot.findMany.mockResolvedValue([
      { id: 'slot-1', courtId: 'court-1', startsAt: TUESDAY_20, priceCents: slotPriceCents, bookings },
    ])
    return { prisma, service: makeService(prisma) }
  }

  it('reprices a free slot to the band price (the price rule beats the default)', async () => {
    const { prisma, service } = setup([])

    const changed = await service.repriceFutureSlots('club-1')

    expect(changed).toBe(1)
    expect(prisma.slot.update).toHaveBeenCalledWith({
      where: { id: 'slot-1' },
      data: { priceCents: 40_000 },
    })
  })

  it('leaves a slot alone when it already carries the right price', async () => {
    const { prisma, service } = setup([], 40_000)

    expect(await service.repriceFutureSlots('club-1')).toBe(0)
    expect(prisma.slot.update).not.toHaveBeenCalled()
  })

  it('reprices a turno fijo to the price agreed for the fijo, not the list price', async () => {
    const { prisma, service } = setup([unpaidBooking({ recurringBooking: { priceCents: 25_000 } })])

    await service.repriceFutureSlots('club-1')

    expect(prisma.slot.update).toHaveBeenCalledWith({
      where: { id: 'slot-1' },
      data: { priceCents: 25_000 },
    })
  })

  it('freezes the price of a booking with a paid seña', async () => {
    const { prisma, service } = setup([unpaidBooking({ transferAmountCents: 5_012 })])

    expect(await service.repriceFutureSlots('club-1')).toBe(0)
    expect(prisma.slot.update).not.toHaveBeenCalled()
  })

  it('freezes the price of a booking with a live transfer quote (PENDING_PAYMENT)', async () => {
    const { service } = setup([unpaidBooking({ status: 'PENDING_PAYMENT' })])

    expect(await service.repriceFutureSlots('club-1')).toBe(0)
  })

  it.each([
    ['consumed player credit', { creditAppliedCents: 5_000 }],
    ['money taken at the mostrador', { localPaymentCents: 10_000 }],
    ['a registered player payment', { playerPayments: [{ id: 'pay-1' }] }],
  ])('freezes the price of a booking with %s', async (_label, overrides) => {
    const { service } = setup([unpaidBooking(overrides)])

    expect(await service.repriceFutureSlots('club-1')).toBe(0)
  })

  it('reprices a slot whose only booking was cancelled — the band is on sale again', async () => {
    const { prisma, service } = setup([unpaidBooking({ status: 'CANCELLED', transferAmountCents: 5_012 })])

    await service.repriceFutureSlots('club-1')

    expect(prisma.slot.update).toHaveBeenCalledWith({
      where: { id: 'slot-1' },
      data: { priceCents: 40_000 },
    })
  })

  it('only looks at future slots — the past is history', async () => {
    const { prisma, service } = setup([])

    await service.repriceFutureSlots('club-1')

    const where = prisma.slot.findMany.mock.calls[0][0].where
    expect(where.startsAt.gt).toBeInstanceOf(Date)
    expect(where.clubId).toBe('club-1')
  })
})

describe('SlotPricingService.repriceSlot', () => {
  it('returns the freed band at the current list price', async () => {
    const prisma = prismaMock()
    prisma.slot.findFirst.mockResolvedValue({
      id: 'slot-1',
      startsAt: TUESDAY_20,
      priceCents: 20_000,
      bookings: [unpaidBooking({ status: 'CANCELLED' })],
      court: { priceCents: 30_000, priceRules: [] },
    })
    const service = makeService(prisma)

    await expect(service.repriceSlot('slot-1', 'club-1')).resolves.toBe(30_000)
    expect(prisma.slot.update).toHaveBeenCalledWith({
      where: { id: 'slot-1' },
      data: { priceCents: 30_000 },
    })
  })

  it('keeps the sold price when the booking still holds money', async () => {
    const prisma = prismaMock()
    prisma.slot.findFirst.mockResolvedValue({
      id: 'slot-1',
      startsAt: TUESDAY_20,
      priceCents: 20_000,
      bookings: [unpaidBooking({ transferAmountCents: 5_012 })],
      court: { priceCents: 30_000, priceRules: [] },
    })
    const service = makeService(prisma)

    await expect(service.repriceSlot('slot-1', 'club-1')).resolves.toBe(20_000)
    expect(prisma.slot.update).not.toHaveBeenCalled()
  })

  it('is a no-op for a slot that no longer exists', async () => {
    const prisma = prismaMock()
    prisma.slot.findFirst.mockResolvedValue(null)
    const service = makeService(prisma)

    await expect(service.repriceSlot('gone', 'club-1')).resolves.toBeNull()
    expect(prisma.slot.update).not.toHaveBeenCalled()
  })
})
