import { ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma } from 'generated/prisma/client'
import { BookingsService } from './bookings.service'

/**
 * The double-booking guards.
 *
 * Two players can tap "reservar" on the same 20:00 court in the same second — one on
 * WhatsApp, one at the front desk. Nothing but these two guards stands between that and
 * two teams showing up for the same court, which is the one failure a club never forgives:
 *
 *  - `lockSlotOrThrow`: a conditional `UPDATE … WHERE status='AVAILABLE'`. The DB decides
 *    the winner; the loser sees `count = 0` and must get a clean ConflictException.
 *  - `createBookedSlot`: for a band with no Slot row yet, the unique index on
 *    (courtId, startsAt) is the guard — the concurrent insert raises P2002, which must
 *    surface as a Conflict, never as a 500.
 *
 * Reading the slot as AVAILABLE first is NOT a guard (the world can change before the
 * write), so every test here asserts on what happens at *write* time.
 */

const FUTURE_DAY = '2030-01-04' // a Friday, far enough ahead that Date.now() can't reach it
const PAST_DAY = '2020-01-03'

const court = {
  priceCents: 20000,
  openTime: '09:00',
  closeTime: '23:00',
  slotDurationMinutes: 90,
  weeklyHours: null,
  priceRules: [],
}

function uniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  })
}

/** `lockWon: false` = the other booker flipped the slot to BOOKED first. */
function setup(lockWon = true) {
  const tx = {
    slot: {
      updateMany: jest.fn().mockResolvedValue({ count: lockWon ? 1 : 0 }),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'slot-new' }),
    },
    booking: {
      create: jest.fn().mockResolvedValue({
        id: 'b1',
        clubId: 'club-1',
        playerName: 'Martínez',
        slot: {
          startsAt: new Date('2030-01-04T22:00:00Z'),
          endsAt: new Date('2030-01-05T01:30:00Z'),
          court: { id: 'court-1', name: 'Cancha 1' },
        },
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    player: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  }
  const prisma = {
    slot: { findFirst: jest.fn() },
    court: { findFirst: jest.fn().mockResolvedValue(court) },
    club: {
      findUnique: jest.fn().mockResolvedValue({
        depositMode: 'DEPOSIT',
        depositPercent: 25,
        requireDniMatch: false,
        paymentVerificationMode: 'AUTO',
      }),
    },
    booking: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
  }
  const events = { emit: jest.fn(), emitSlotFreed: jest.fn() }
  const notifications = { notifyClub: jest.fn() }
  const players = {
    upsertForBooking: jest.fn().mockResolvedValue('p1'),
    standingForPhone: jest.fn().mockResolvedValue({ isBlocked: false, noShowCount: 0, creditCents: 0 }),
  }
  const service = new BookingsService(
    prisma as never,
    events as never,
    {} as never,
    notifications as never,
    players as never,
    { repriceSlot: jest.fn(), repriceFutureSlots: jest.fn() } as never,
  )
  return { service, prisma, tx }
}

describe('BookingsService.book (an existing slot)', () => {
  const dto = { slotId: 'slot-1', playerName: 'Martínez', playerPhone: '5493411234567' }

  it('books the slot when it wins the atomic flip', async () => {
    const { service, prisma, tx } = setup()
    prisma.slot.findFirst.mockResolvedValue({ id: 'slot-1', status: 'AVAILABLE', priceCents: 20000 })

    await service.book('club-1', dto as never)

    // The lock is a conditional update — the WHERE clause is the entire guarantee.
    expect(tx.slot.updateMany).toHaveBeenCalledWith({
      where: { id: 'slot-1', clubId: 'club-1', status: 'AVAILABLE' },
      data: { status: 'BOOKED' },
    })
    expect(tx.booking.create).toHaveBeenCalled()
  })

  it('rejects the loser of the race instead of double-booking the court', async () => {
    const { service, prisma, tx } = setup(false)
    // It looked AVAILABLE when we read it…
    prisma.slot.findFirst.mockResolvedValue({ id: 'slot-1', status: 'AVAILABLE', priceCents: 20000 })

    // …but somebody else took it before our write landed.
    await expect(service.book('club-1', dto as never)).rejects.toThrow(ConflictException)
    expect(tx.booking.create).not.toHaveBeenCalled()
  })

  it('refuses a slot that is already booked or blocked', async () => {
    const { service, prisma, tx } = setup()
    prisma.slot.findFirst.mockResolvedValue({ id: 'slot-1', status: 'BOOKED', priceCents: 20000 })

    await expect(service.book('club-1', dto as never)).rejects.toThrow(ConflictException)
    expect(tx.slot.updateMany).not.toHaveBeenCalled()
  })

  it('never reaches across tenants: an unknown slot for this club is a 404', async () => {
    const { service, prisma } = setup()
    prisma.slot.findFirst.mockResolvedValue(null)

    await expect(service.book('club-1', dto as never)).rejects.toThrow(NotFoundException)
    expect(prisma.slot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'slot-1', clubId: 'club-1' } }),
    )
  })
})

describe('BookingsService.bookPending (the bot path: lock now, pay within the window)', () => {
  const dto = { slotId: 'slot-1', playerName: 'Martínez', playerPhone: '5493411234567' }

  it('holds the court the moment the player asks for it, before any money moves', async () => {
    const { service, prisma, tx } = setup()
    prisma.slot.findFirst.mockResolvedValue({ id: 'slot-1', status: 'AVAILABLE', priceCents: 20000 })

    await service.bookPending('club-1', dto as never)

    // Locked inside the same transaction that creates the pending booking: two players can't
    // both be sent the alias for the same 20:00 court.
    expect(tx.slot.updateMany).toHaveBeenCalledWith({
      where: { id: 'slot-1', clubId: 'club-1', status: 'AVAILABLE' },
      data: { status: 'BOOKED' },
    })
    expect(tx.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING_PAYMENT' }) }),
    )
  })

  it('rejects the loser instead of asking two players to pay for the same court', async () => {
    const { service, prisma, tx } = setup(false)
    prisma.slot.findFirst.mockResolvedValue({ id: 'slot-1', status: 'AVAILABLE', priceCents: 20000 })

    await expect(service.bookPending('club-1', dto as never)).rejects.toThrow(ConflictException)
    expect(tx.booking.create).not.toHaveBeenCalled()
  })
})

describe('BookingsService.bookBand (an open band with no slot row yet)', () => {
  const input = {
    courtId: 'court-1',
    dateKey: FUTURE_DAY,
    bandStart: '09:00',
    playerName: 'Martínez',
    playerPhone: '5493411234567',
  }

  it('materializes the slot as BOOKED in one atomic insert', async () => {
    const { service, tx } = setup()

    await service.bookBand('club-1', input as never)

    expect(tx.slot.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'BOOKED', courtId: 'court-1' }) }),
    )
    expect(tx.booking.create).toHaveBeenCalled()
  })

  it('turns the concurrent-insert race (P2002) into a Conflict, not a 500', async () => {
    const { service, tx } = setup()
    // The other booker inserted the same (courtId, startsAt) a millisecond earlier.
    tx.slot.create.mockRejectedValue(uniqueConstraintError())

    await expect(service.bookBand('club-1', input as never)).rejects.toThrow(ConflictException)
    expect(tx.booking.create).not.toHaveBeenCalled()
  })

  it('locks the existing slot when the band was already materialized', async () => {
    const { service, tx } = setup(false)
    tx.slot.findFirst.mockResolvedValue({ id: 'slot-1', status: 'AVAILABLE' })

    // Same race, same clean rejection — through the lock path this time.
    await expect(service.bookBand('club-1', input as never)).rejects.toThrow(ConflictException)
    expect(tx.slot.create).not.toHaveBeenCalled()
  })

  it('refuses to book a band that already started', async () => {
    const { service, tx } = setup()

    await expect(service.bookBand('club-1', { ...input, dateKey: PAST_DAY } as never)).rejects.toThrow(
      ConflictException,
    )
    expect(tx.slot.create).not.toHaveBeenCalled()
  })

  it('rejects a band the court does not actually offer', async () => {
    const { service } = setup()

    // 09:20 is not a band start: the court opens 09:00 and runs 90-minute bands.
    await expect(service.bookBand('club-1', { ...input, bandStart: '09:20' } as never)).rejects.toThrow(
      /Invalid slot band/,
    )
  })
})
