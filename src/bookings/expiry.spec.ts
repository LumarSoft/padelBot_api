import { BookingsService } from './bookings.service'

/**
 * The expiry side of the money race.
 *
 * `money-flow.spec.ts` covers one order of events: the cleanup cancels first, the transfer
 * shows up afterwards, and the booking is revived. This file covers the opposite order,
 * which is the dangerous one:
 *
 *   1. the cleanup cron reads the bookings whose payment window has expired,
 *   2. the poller (every 20s, scanning with a grace margin) confirms one of them — the
 *      player DID transfer inside the window, MercadoPago just reported it late,
 *   3. the cleanup writes.
 *
 * If that write is unconditional it un-confirms a booking the player already paid and was
 * already told was confirmed, frees the court for somebody else, and sends them a "tu
 * reserva venció". The cancellation must therefore be conditional on the booking still
 * being PENDING_PAYMENT at write time — the mirror image of the guard in `confirmPayment`.
 *
 * Prisma is mocked at the query level; `count` is what the DB would report for the
 * conditional update, so `count: 0` *is* the poller winning the race.
 */

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    slotId: 'slot-1',
    playerPhone: '5493411234567',
    playerId: null,
    creditAppliedCents: 0,
    clubId: 'club-1',
    playerName: 'Martínez',
    status: 'PENDING_PAYMENT',
    slot: {
      startsAt: new Date('2026-07-12T22:00:00Z'),
      endsAt: new Date('2026-07-13T01:30:00Z'),
      priceCents: 20000,
      court: { id: 'court-1', name: 'Cancha 1' },
    },
    ...overrides,
  }
}

/** `wonTheRace: false` = the poller confirmed the booking between our read and our write. */
function setup(wonTheRace = true) {
  const tx = {
    booking: { updateMany: jest.fn().mockResolvedValue({ count: wonTheRace ? 1 : 0 }) },
    slot: { update: jest.fn().mockResolvedValue({}) },
    player: { update: jest.fn().mockResolvedValue({}) },
  }
  const prisma = {
    booking: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
    paymentReceipt: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
    $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
  }
  const events = { emit: jest.fn(), emitSlotFreed: jest.fn() }
  const notifications = { notifyClub: jest.fn() }
  const service = new BookingsService(
    prisma as never,
    events as never,
    {} as never,
    notifications as never,
    {} as never,
  )
  return { service, prisma, tx, events }
}

describe('BookingsService.findAndCancelExpiredPending', () => {
  it('cancels the expired booking and releases its slot', async () => {
    const { service, prisma, tx, events } = setup()
    prisma.booking.findMany.mockResolvedValue([bookingRow()])

    const cancelled = await service.findAndCancelExpiredPending()

    expect(tx.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'b1', status: 'PENDING_PAYMENT' },
      data: { status: 'CANCELLED' },
    })
    expect(tx.slot.update).toHaveBeenCalledWith({ where: { id: 'slot-1' }, data: { status: 'AVAILABLE' } })
    // The freed court is broadcast so the waitlist can be offered it.
    expect(events.emitSlotFreed).toHaveBeenCalledWith(expect.objectContaining({ type: 'slot.freed' }))
    // Reported back so the player gets the "tu reserva venció" message.
    expect(cancelled).toEqual([{ playerPhone: '5493411234567', clubId: 'club-1' }])
  })

  it('NEVER un-confirms a booking the poller confirmed in the gap', async () => {
    // The player transferred at minute 29; MercadoPago reported it at minute 31, so the
    // poller flipped this booking to CONFIRMED after our read but before our write.
    const { service, prisma, tx, events } = setup(false)
    prisma.booking.findMany.mockResolvedValue([bookingRow()])

    const cancelled = await service.findAndCancelExpiredPending()

    // The court stays theirs: no release, no "slot freed" broadcast to the waitlist…
    expect(tx.slot.update).not.toHaveBeenCalled()
    expect(events.emitSlotFreed).not.toHaveBeenCalled()
    // …and no "tu reserva venció" WhatsApp to someone who paid and was told it was confirmed.
    expect(cancelled).toEqual([])
  })

  it('gives back the credit the pending had consumed (nothing was ever paid)', async () => {
    const { service, prisma, tx } = setup()
    prisma.booking.findMany.mockResolvedValue([bookingRow({ playerId: 'p1', creditAppliedCents: 5000 })])

    await service.findAndCancelExpiredPending()

    expect(tx.player.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { creditCents: { increment: 5000 } },
    })
  })

  it('does not touch the credit of a booking that lost the race', async () => {
    // The player paid the remainder by transfer; the credit stays spent on the booking.
    const { service, prisma, tx } = setup(false)
    prisma.booking.findMany.mockResolvedValue([bookingRow({ playerId: 'p1', creditAppliedCents: 5000 })])

    await service.findAndCancelExpiredPending()

    expect(tx.player.update).not.toHaveBeenCalled()
  })

  it('only scans pendings past their window whose receipt has not arrived', async () => {
    const { service, prisma } = setup()

    await service.findAndCancelExpiredPending()

    const { where } = prisma.booking.findMany.mock.calls[0][0]
    expect(where.status).toBe('PENDING_PAYMENT')
    expect(where.paymentExpiresAt.lt).toBeInstanceOf(Date)
    // A player who already sent the receipt photo is waiting on a human, not on the clock.
    expect(where.receiptUploadedAt).toBeNull()
  })

  it('keeps cancelling the rest when one booking fails', async () => {
    const { service, prisma } = setup()
    prisma.booking.findMany.mockResolvedValue([bookingRow({ id: 'b1' }), bookingRow({ id: 'b2' })])
    prisma.$transaction.mockRejectedValueOnce(new Error('deadlock'))

    const cancelled = await service.findAndCancelExpiredPending()

    expect(cancelled).toHaveLength(1)
  })
})

describe('BookingsService.cancelPending', () => {
  it('releases the slot of a pending booking', async () => {
    const { service, prisma, tx } = setup()
    prisma.booking.findUnique.mockResolvedValue(bookingRow())

    expect(await service.cancelPending('b1')).toEqual({ playerPhone: '5493411234567', clubId: 'club-1' })
    expect(tx.slot.update).toHaveBeenCalled()
  })

  it('is a no-op on a booking that is no longer pending', async () => {
    const { service, prisma, tx } = setup()
    prisma.booking.findUnique.mockResolvedValue(bookingRow({ status: 'CONFIRMED' }))

    expect(await service.cancelPending('b1')).toBeNull()
    expect(tx.booking.updateMany).not.toHaveBeenCalled()
  })

  it('bails out when the booking is confirmed between the read and the write', async () => {
    // Admin hits "rechazar" at the same moment the transfer lands.
    const { service, prisma, tx } = setup(false)
    prisma.booking.findUnique.mockResolvedValue(bookingRow())

    expect(await service.cancelPending('b1')).toBeNull()
    expect(tx.slot.update).not.toHaveBeenCalled()
  })
})
