import { DepositMode } from 'generated/prisma/client'
import { BookingsService, NoShowReviewRequiredException } from './bookings.service'

/**
 * "Sin seña" (DepositMode.NONE): the bot works as the club's booking book.
 *
 * Feedback from the field: a lot of clubs want "un anotador de turnos" — name, phone, whether
 * the player confirmed — long before they want the bot collecting money. With NONE the bot takes
 * the booking down and confirms it on the spot. Nothing is pending, so nothing downstream of a
 * seña (poller, centavos tag, expiry sweep, DNI match, credit) may ever see these bookings.
 *
 * The same holds for a seña that works out to $0 — a court with no price loaded. It used to be
 * held PENDING asking for a $0,00 transfer nobody can make, and expire 30 minutes later.
 */

const FUTURE_DAY = '2030-01-04'
const PHONE = '5493411234567'

const court = {
  priceCents: 2000000,
  openTime: '09:00',
  closeTime: '23:00',
  slotDurationMinutes: 90,
  weeklyHours: null,
  priceRules: [],
}

const SLOT = {
  startsAt: new Date('2030-01-04T22:00:00Z'),
  endsAt: new Date('2030-01-04T23:30:00Z'),
  court: { id: 'court-1', name: 'Cancha 1' },
}

function setup(
  opts: {
    depositMode?: DepositMode
    slotPriceCents?: number
    noShowCount?: number
    creditCents?: number
  } = {},
) {
  const { depositMode = 'NONE', slotPriceCents = 2000000, noShowCount = 0, creditCents = 0 } = opts
  const tx = {
    slot: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'slot-new' }),
    },
    booking: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'b1', slot: SLOT, ...data })),
      // Pending bookings in the same peso bucket — only read by the centavos allocator.
      findMany: jest.fn().mockResolvedValue([]),
    },
    player: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  }
  const prisma = {
    slot: { findFirst: jest.fn().mockResolvedValue({ id: 'slot-1', status: 'AVAILABLE', priceCents: slotPriceCents }) },
    court: { findFirst: jest.fn().mockResolvedValue({ ...court, priceCents: slotPriceCents }) },
    club: {
      findUnique: jest.fn().mockResolvedValue({
        depositMode,
        depositPercent: 25,
        requireDniMatch: true,
        paymentVerificationMode: 'AUTO',
      }),
    },
    booking: {
      // findKnownPayerIdentity: this phone already paid a seña once, from a known account.
      findFirst: jest.fn().mockResolvedValue({ payerMpUserId: 'mp-777', payerCuit: null }),
      findUnique: jest.fn().mockResolvedValue({
        id: 'b1',
        clubId: 'club-1',
        playerName: 'Martínez',
        status: 'CONFIRMED',
        slot: SLOT,
      }),
    },
    $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
  }
  const events = { emit: jest.fn(), emitSlotFreed: jest.fn() }
  const notifications = { notifyClub: jest.fn().mockResolvedValue(undefined) }
  const players = {
    upsertForBooking: jest.fn().mockResolvedValue('p1'),
    standingForPhone: jest.fn().mockResolvedValue({ isBlocked: false, noShowCount, creditCents }),
  }
  // Untyped constructor: these tests only exercise the dependencies listed here, and the stub
  // list shouldn't break every time the service gains an unrelated one.
  const Service = BookingsService as unknown as new (...deps: unknown[]) => BookingsService
  const service = new Service(
    prisma,
    events,
    {},
    notifications,
    players,
    { repriceSlot: jest.fn(), repriceFutureSlots: jest.fn() },
    {},
    {}, // plans
    { record: jest.fn() }, // audit
  )
  return { service, prisma, tx, events, notifications }
}

const dto = { slotId: 'slot-1', playerName: 'Martínez', playerPhone: PHONE }
const createdData = (tx: ReturnType<typeof setup>['tx']) =>
  (tx.booking.create.mock.calls[0][0] as { data: Record<string, unknown> }).data

describe('bot booking at a club on NONE', () => {
  it('books the court CONFIRMED on the spot: no transfer amount, no payment window', async () => {
    const { service, tx } = setup()

    const result = await service.bookPending('club-1', dto as never)

    expect(createdData(tx)).toEqual(
      expect.objectContaining({
        status: 'CONFIRMED',
        depositCents: 0,
        transferAmountCents: null,
        paymentExpiresAt: null,
        creditAppliedCents: 0,
      }),
    )
    expect(result).toEqual(
      expect.objectContaining({ confirmedWithoutDeposit: true, confirmedByCredit: false, transferAmountCents: 0 }),
    )
  })

  it('still locks the court atomically — no seña does not mean no double-booking guard', async () => {
    const { service, tx } = setup()

    await service.bookPending('club-1', dto as never)

    expect(tx.slot.updateMany).toHaveBeenCalledWith({
      where: { id: 'slot-1', clubId: 'club-1', status: 'AVAILABLE' },
      data: { status: 'BOOKED' },
    })
  })

  it('never touches the reconciliation machinery: no centavos tag, no payer stamp', async () => {
    const { service, tx, prisma } = setup()

    await service.bookPending('club-1', dto as never)

    // The centavos allocator reads the pending bookings of the bucket — it must not run.
    expect(tx.booking.findMany).not.toHaveBeenCalled()
    // Nobody will transfer, so there is no expected payer to stamp on the booking.
    expect(prisma.booking.findFirst).not.toHaveBeenCalled()
    expect(createdData(tx).payerMpUserId).toBeNull()
  })

  it('leaves player credit alone: it stays for a booking that does carry a seña', async () => {
    const { service, tx } = setup({ creditCents: 500000 })

    await service.bookPending('club-1', dto as never)

    expect(tx.player.updateMany).not.toHaveBeenCalled()
    expect(createdData(tx).creditAppliedCents).toBe(0)
  })

  it('tells the panel and the staff app right away — no payment confirmation will ever do it', async () => {
    const { service, events, notifications } = setup()

    await service.bookPending('club-1', dto as never)

    expect(events.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'booking.changed', action: 'created' }))
    expect(notifications.notifyClub).toHaveBeenCalledWith(
      'club-1',
      expect.objectContaining({ title: expect.stringContaining('Nueva reserva confirmada') }),
    )
  })

  it('works the same for a band with no slot row yet', async () => {
    const { service, tx } = setup()

    const result = await service.bookBandPending('club-1', {
      courtId: 'court-1',
      dateKey: FUTURE_DAY,
      bandStart: '18:00',
      playerName: 'Martínez',
      playerPhone: PHONE,
    })

    expect(createdData(tx)).toEqual(expect.objectContaining({ status: 'CONFIRMED', transferAmountCents: null }))
    expect(result.confirmedWithoutDeposit).toBe(true)
  })
})

describe('a seña that works out to $0 behaves like NONE', () => {
  it('books a court with no price CONFIRMED instead of asking a $0,00 transfer that then expires', async () => {
    const { service, tx } = setup({ depositMode: 'DEPOSIT', slotPriceCents: 0 })

    const result = await service.bookPending('club-1', dto as never)

    expect(createdData(tx)).toEqual(
      expect.objectContaining({ status: 'CONFIRMED', transferAmountCents: null, paymentExpiresAt: null }),
    )
    expect(result.confirmedWithoutDeposit).toBe(true)
  })

  it('keeps asking the seña when the court does have a price', async () => {
    const { service, tx } = setup({ depositMode: 'DEPOSIT' })

    const result = await service.bookPending('club-1', dto as never)

    expect(createdData(tx)).toEqual(
      expect.objectContaining({ status: 'PENDING_PAYMENT', depositCents: 500000, transferAmountCents: 500000 }),
    )
    expect(result.confirmedWithoutDeposit).toBe(false)
  })
})

describe('the no-show rule without a seña to escalate', () => {
  it('hands a player at the threshold to the club instead of booking (NONE)', async () => {
    const { service, tx } = setup({ noShowCount: 3 })

    const attempt = service.bookPending('club-1', dto as never)

    await expect(attempt).rejects.toBeInstanceOf(NoShowReviewRequiredException)
    await expect(attempt).rejects.toMatchObject({ noShowCount: 3 })
    // Nothing is held: the club decides, and may well give them the court.
    expect(tx.slot.updateMany).not.toHaveBeenCalled()
    expect(tx.booking.create).not.toHaveBeenCalled()
  })

  it('does the same on a court with no price, where the "full price" would be $0', async () => {
    const { service } = setup({ depositMode: 'DEPOSIT', slotPriceCents: 0, noShowCount: 4 })

    await expect(service.bookPending('club-1', dto as never)).rejects.toBeInstanceOf(NoShowReviewRequiredException)
  })

  it('keeps demanding the full price as the seña when the club charges one', async () => {
    const { service, tx } = setup({ depositMode: 'DEPOSIT', noShowCount: 3 })

    await service.bookPending('club-1', dto as never)

    expect(createdData(tx)).toEqual(expect.objectContaining({ status: 'PENDING_PAYMENT', depositCents: 2000000 }))
  })

  it('lets a player under the threshold book normally', async () => {
    const { service, tx } = setup({ noShowCount: 2 })

    await service.bookPending('club-1', dto as never)

    expect(createdData(tx).status).toBe('CONFIRMED')
  })
})

describe('front-desk booking at a club on NONE', () => {
  it('is confirmed, not left "pendiente de seña" for money nobody owes', async () => {
    const { service, tx, notifications } = setup()

    await service.book('club-1', dto as never, 7)

    expect(createdData(tx)).toEqual(expect.objectContaining({ status: 'CONFIRMED', depositCents: 0 }))
    expect(notifications.notifyClub).toHaveBeenCalledWith(
      'club-1',
      expect.objectContaining({ title: expect.not.stringContaining('pendiente de seña') }),
    )
  })

  it('stays pending when the club charges a seña (the desk confirms the money)', async () => {
    const { service, tx } = setup({ depositMode: 'DEPOSIT' })

    await service.book('club-1', dto as never, 7)

    expect(createdData(tx).status).toBeUndefined()
    expect(createdData(tx).depositCents).toBe(500000)
  })
})

describe('moving a booking that never had a seña', () => {
  function withBooking(booking: Record<string, unknown>) {
    const base = setup()
    const prisma = base.prisma as unknown as {
      booking: { findFirst: jest.Mock }
      club: { findUnique: jest.Mock }
    }
    prisma.booking.findFirst.mockResolvedValue({
      rescheduleCount: 0,
      slot: { startsAt: new Date('2030-01-04T22:00:00Z'), priceCents: 2000000, court: { name: 'Cancha 1' } },
      ...booking,
    })
    prisma.club.findUnique.mockResolvedValue({
      playerReschedule: 'SELF',
      playerRescheduleCutoffHours: null,
      maxPlayerReschedules: 1,
    })
    return base.service
  }

  it('reports no seña on a booking confirmed without one', async () => {
    const service = withBooking({ status: 'CONFIRMED', transferAmountCents: null, creditAppliedCents: 0 })

    const policy = await service.reschedulePolicyForPlayer('club-1', 'b1', PHONE)

    expect(policy).toEqual(expect.objectContaining({ mode: 'SELF', carriesDeposit: false }))
  })

  it('reports the seña on a booking that paid one', async () => {
    const service = withBooking({ status: 'CONFIRMED', transferAmountCents: 500000, creditAppliedCents: 0 })

    expect((await service.reschedulePolicyForPlayer('club-1', 'b1', PHONE))?.carriesDeposit).toBe(true)
  })

  it('reports the seña on a booking still waiting for it', async () => {
    const service = withBooking({ status: 'PENDING_PAYMENT', transferAmountCents: 500000, creditAppliedCents: 0 })

    expect((await service.reschedulePolicyForPlayer('club-1', 'b1', PHONE))?.carriesDeposit).toBe(true)
  })
})
