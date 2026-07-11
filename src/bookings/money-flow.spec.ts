import { BookingsService } from './bookings.service'

/**
 * Unit tests for the money-moving logic:
 *  - allocateTransferAmount: the centavos-tag uniqueness that maps one transfer → one booking
 *  - confirmPaymentByAmount: single-use refs, time window, ambiguity, DNI mode
 *  - the expiry-vs-payment race: an in-window transfer seen after cleanup revives the booking
 *
 * Prisma is mocked at the query level; each test states what the DB "contains".
 */

type MockFn = jest.Mock

interface PrismaMock {
  booking: { findFirst: MockFn; findMany: MockFn; update: MockFn; updateMany: MockFn; findUnique: MockFn }
  player: { updateMany: MockFn }
  slot: { updateMany: MockFn }
  club: { findUnique: MockFn }
}

function prismaMock(): PrismaMock {
  return {
    booking: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
    player: { updateMany: jest.fn() },
    slot: { updateMany: jest.fn() },
    club: { findUnique: jest.fn() },
  }
}

function makeService(prisma: PrismaMock): BookingsService {
  return new BookingsService(prisma as never, {} as never, {} as never, {} as never, {} as never)
}

describe('BookingsService.allocateTransferAmount', () => {
  const call = (service: BookingsService, tx: unknown, depositCents: number) =>
    (
      service as unknown as { allocateTransferAmount: (tx: unknown, d: number) => Promise<number> }
    ).allocateTransferAmount(tx, depositCents)

  function txWithPendingAmounts(amounts: number[]) {
    return {
      booking: {
        findMany: jest.fn().mockResolvedValue(amounts.map(a => ({ transferAmountCents: a }))),
      },
    }
  }

  it('prefers the deposit’s own centavos when the tag is free', async () => {
    const service = makeService(prismaMock())
    // Deposit $125.50 — nothing pending in the 12500–12599 bucket.
    expect(await call(service, txWithPendingAmounts([]), 12550)).toBe(12550)
  })

  it('keeps a clean round amount for a whole-peso deposit', async () => {
    const service = makeService(prismaMock())
    expect(await call(service, txWithPendingAmounts([]), 12500)).toBe(12500)
  })

  it('picks a different free centavos tag when the exact amount collides', async () => {
    const service = makeService(prismaMock())
    // Another pending already asks exactly 12500 → allocate a different tag in the bucket.
    const allocated = await call(service, txWithPendingAmounts([12500]), 12500)
    expect(allocated).not.toBe(12500)
    expect(Math.floor(allocated / 100)).toBe(125)
  })

  it('never allocates a tag already taken by another pending booking', async () => {
    const service = makeService(prismaMock())
    const taken = [12500, 12501, 12502]
    const allocated = await call(service, txWithPendingAmounts(taken), 12500)
    expect(taken).not.toContain(allocated)
  })

  it('falls back to the raw deposit when all 100 tags are taken', async () => {
    const service = makeService(prismaMock())
    const all = Array.from({ length: 100 }, (_, tag) => 12500 + tag)
    expect(await call(service, txWithPendingAmounts(all), 12550)).toBe(12550)
  })
})

describe('BookingsService.confirmPaymentByAmount', () => {
  const paidAt = new Date('2026-07-10T18:29:00Z')

  function setup() {
    const prisma = prismaMock()
    const service = makeService(prisma)
    const confirmSpy = jest
      .spyOn(service as never, 'confirmPayment' as never)
      .mockResolvedValue(true as never) as unknown as jest.Mock
    // No transfer ref reuse by default.
    prisma.booking.findFirst.mockResolvedValue(null)
    // Default club: no DNI requirement.
    prisma.club.findUnique.mockResolvedValue({ requireDniMatch: false })
    return { prisma, service, confirmSpy }
  }

  it('confirms the single candidate matched by its unique amount', async () => {
    const { prisma, service, confirmSpy } = setup()
    prisma.booking.findMany.mockResolvedValueOnce([{ id: 'b1', playerDni: null, payerMpUserId: null }])

    const result = await service.confirmPaymentByAmount(12550, 'mp-1', paidAt)
    expect(result).toBe('b1')
    expect(confirmSpy).toHaveBeenCalledWith('b1', 'mp-1', undefined)
  })

  it('never confirms twice from the same transfer (single-use ref)', async () => {
    const { prisma, service, confirmSpy } = setup()
    prisma.booking.findFirst.mockResolvedValue({ id: 'already' })

    expect(await service.confirmPaymentByAmount(12550, 'mp-1', paidAt)).toBeNull()
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('only considers bookings whose payment window covers the transfer time', async () => {
    const { prisma, service } = setup()
    prisma.booking.findMany.mockResolvedValue([])

    await service.confirmPaymentByAmount(12550, 'mp-1', paidAt)
    const where = prisma.booking.findMany.mock.calls[0][0].where
    expect(where.createdAt).toEqual({ lte: paidAt })
    expect(where.paymentExpiresAt).toEqual({ gte: paidAt })
    expect(where.status).toBe('PENDING_PAYMENT')
  })

  it('leaves an ambiguous round amount (two strangers) for manual review', async () => {
    const { prisma, service, confirmSpy } = setup()
    prisma.booking.findMany.mockResolvedValueOnce([
      { id: 'b1', playerDni: null, payerMpUserId: '111' },
      { id: 'b2', playerDni: null, payerMpUserId: '222' },
    ])

    expect(await service.confirmPaymentByAmount(12500, 'mp-1', paidAt, undefined, { mpUserId: '999' })).toBeNull()
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('in DNI mode, confirms only the booking whose DNI matches the payer', async () => {
    const { prisma, service, confirmSpy } = setup()
    prisma.club.findUnique.mockResolvedValue({ requireDniMatch: true })
    prisma.booking.findMany.mockResolvedValueOnce([
      { id: 'b1', playerDni: '30111111', payerMpUserId: null },
      { id: 'b2', playerDni: '44428719', payerMpUserId: null },
    ])

    // CUIT 20-44428719-6 → DNI 44428719
    const result = await service.confirmPaymentByAmount(12500, 'mp-1', paidAt, 'club-1', { cuit: '20444287196' })
    expect(result).toBe('b2')
    expect(confirmSpy).toHaveBeenCalledWith('b2', 'mp-1', { cuit: '20444287196' })
  })

  it('in DNI mode, refuses to confirm when the payer DNI is unavailable', async () => {
    const { prisma, service, confirmSpy } = setup()
    prisma.club.findUnique.mockResolvedValue({ requireDniMatch: true })
    prisma.booking.findMany.mockResolvedValueOnce([{ id: 'b1', playerDni: '30111111', payerMpUserId: null }])

    expect(await service.confirmPaymentByAmount(12500, 'mp-1', paidAt, 'club-1', {})).toBeNull()
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  describe('expiry-vs-payment race (transfer in-window, seen after cleanup)', () => {
    function raceSetup() {
      const base = setup()
      // First findMany (PENDING candidates) → none; second (revival CANCELLED lookup) is
      // configured per test.
      base.prisma.booking.findMany.mockResolvedValueOnce([])
      return base
    }

    it('revives and confirms the expired booking when the slot is still free', async () => {
      const { prisma, service, confirmSpy } = raceSetup()
      prisma.booking.findMany.mockResolvedValueOnce([
        { id: 'expired-1', slotId: 'slot-1', playerDni: null, payerMpUserId: null },
      ])
      prisma.slot.updateMany.mockResolvedValue({ count: 1 }) // slot re-taken atomically
      prisma.booking.update.mockResolvedValue({})

      const result = await service.confirmPaymentByAmount(12550, 'mp-1', paidAt)
      expect(result).toBe('expired-1')
      // Revived back to PENDING so the normal confirm path runs.
      expect(prisma.booking.update).toHaveBeenCalledWith({
        where: { id: 'expired-1' },
        data: { status: 'PENDING_PAYMENT' },
      })
      expect(confirmSpy).toHaveBeenCalledWith('expired-1', 'mp-1', undefined)
    })

    it('does NOT revive when the slot was already re-taken (manual refund)', async () => {
      const { prisma, service, confirmSpy } = raceSetup()
      prisma.booking.findMany.mockResolvedValueOnce([
        { id: 'expired-1', slotId: 'slot-1', playerDni: null, payerMpUserId: null },
      ])
      prisma.slot.updateMany.mockResolvedValue({ count: 0 }) // someone else booked it

      expect(await service.confirmPaymentByAmount(12550, 'mp-1', paidAt)).toBeNull()
      expect(confirmSpy).not.toHaveBeenCalled()
    })

    it('only revives bookings that were cancelled unpaid with the window covering the payment', async () => {
      const { prisma, service } = raceSetup()
      prisma.booking.findMany.mockResolvedValueOnce([])

      await service.confirmPaymentByAmount(12550, 'mp-1', paidAt)
      const where = prisma.booking.findMany.mock.calls[1][0].where
      expect(where.status).toBe('CANCELLED')
      expect(where.mpPaymentId).toBeNull()
      expect(where.depositOutcome).toBeNull()
      expect(where.paymentExpiresAt).toEqual({ gte: paidAt })
    })
  })
})
