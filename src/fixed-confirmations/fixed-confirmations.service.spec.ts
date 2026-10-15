import { BadRequestException } from '@nestjs/common'
import { BookingsService } from '../bookings/bookings.service'
import { BookingEventsService } from '../events/booking-events.service'
import { WaitlistService } from '../waitlist/waitlist.service'
import { FixedConfirmationsService } from './fixed-confirmations.service'
import { buildAttendancePayload } from './lib/payload'

/**
 * The fijo's tap on "Sí, voy" / "No puedo". What must hold:
 *
 * - The payload alone authorizes nothing: the booking is looked up inside the club whose line
 *   received the tap, and it must belong to the number that tapped (typed by hand in the panel,
 *   so "0341 15 555 1234" has to match the wa_id 5493415551234).
 * - A repeated tap is harmless: same answer, no second write, no second release.
 * - "No puedo" releases ONLY that date, through the same cancellation as everything else, so the
 *   freed court reaches the waitlist.
 */

const CLUB = 'club-1'
const WA_ID = '5493415551234'
const inHours = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000)

function fijoRow(overrides: Record<string, unknown> = {}) {
  const startsAt = inHours(20)
  return {
    id: 'b1',
    slotId: 'slot-1',
    clubId: CLUB,
    playerName: 'Juan Pérez',
    playerPhone: '0341 15 555 1234',
    playerId: null,
    status: 'CONFIRMED',
    recurringBookingId: 'rb-1',
    attendanceConfirmed: null,
    transferAmountCents: null,
    creditAppliedCents: 0,
    _count: { receipts: 0 },
    bookingProducts: [],
    slot: {
      id: 'slot-1',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 90 * 60 * 1000),
      priceCents: 2_000_000,
      court: { id: 'court-1', name: 'Cancha 1' },
    },
    ...overrides,
  }
}

function setup(row: Record<string, unknown> | null = fijoRow()) {
  const prisma = {
    booking: { findFirst: jest.fn().mockResolvedValue(row) },
  }
  const bookings = {
    confirmAttendance: jest.fn().mockResolvedValue(true),
    cancel: jest.fn().mockResolvedValue({}),
  }
  const notifications = { notifyClub: jest.fn().mockResolvedValue(undefined) }
  const service = new FixedConfirmationsService(
    prisma as never,
    bookings as never,
    notifications as never,
    {} as never,
    {} as never,
    { botPaused: jest.fn().mockResolvedValue(false) } as never,
  )
  return { service, prisma, bookings, notifications }
}

describe('FixedConfirmationsService.handleButtonReply — tenant and phone', () => {
  it('looks the booking up only inside the club that received the tap', async () => {
    const { service, prisma, bookings } = setup(null)

    const reply = await service.handleButtonReply(CLUB, WA_ID, buildAttendancePayload('NO', 'b-of-another-club'))

    expect(prisma.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'b-of-another-club', clubId: CLUB, deletedAt: null } }),
    )
    expect(reply).toContain('No encontramos ese turno')
    expect(bookings.cancel).not.toHaveBeenCalled()
  })

  it('never acts for a number that is not the fijo’s', async () => {
    const { service, bookings } = setup()

    const reply = await service.handleButtonReply(CLUB, '5493419999999', buildAttendancePayload('NO', 'b1'))

    expect(reply).toContain('No encontramos ese turno')
    expect(bookings.cancel).not.toHaveBeenCalled()
    expect(bookings.confirmAttendance).not.toHaveBeenCalled()
  })

  it('matches the wa_id against the phone as the front desk typed it', async () => {
    const { service, bookings } = setup(fijoRow({ playerPhone: '0341 15 555 1234' }))

    await service.handleButtonReply(CLUB, WA_ID, buildAttendancePayload('YES', 'b1'))

    expect(bookings.confirmAttendance).toHaveBeenCalledWith(CLUB, 'b1')
  })

  it('ignores bookings that are not fijos', async () => {
    const { service, bookings } = setup(fijoRow({ recurringBookingId: null }))

    const reply = await service.handleButtonReply(CLUB, WA_ID, buildAttendancePayload('NO', 'b1'))

    expect(reply).toContain('No encontramos ese turno')
    expect(bookings.cancel).not.toHaveBeenCalled()
  })

  it('returns null for a payload that is not ours, so the tap goes through the bot', async () => {
    const { service, prisma } = setup()

    expect(await service.handleButtonReply(CLUB, WA_ID, 'SOMETHING_ELSE')).toBeNull()
    expect(prisma.booking.findFirst).not.toHaveBeenCalled()
  })
})

describe('FixedConfirmationsService.handleButtonReply — answers and idempotency', () => {
  it('"Sí, voy" marks the fijo as coming and thanks them', async () => {
    const { service, bookings } = setup()

    const reply = await service.handleButtonReply(CLUB, WA_ID, buildAttendancePayload('YES', 'b1'))

    expect(bookings.confirmAttendance).toHaveBeenCalledWith(CLUB, 'b1')
    expect(reply).toContain('Te esperamos')
  })

  it('a second "Sí, voy" answers the same and writes nothing', async () => {
    const { service, bookings } = setup(fijoRow({ attendanceConfirmed: true }))

    const reply = await service.handleButtonReply(CLUB, WA_ID, buildAttendancePayload('YES', 'b1'))

    expect(bookings.confirmAttendance).not.toHaveBeenCalled()
    expect(reply).toContain('Te esperamos')
  })

  it('"No puedo" releases that date as an attendance decline and tells the staff', async () => {
    const { service, bookings, notifications } = setup()

    const reply = await service.handleButtonReply(CLUB, WA_ID, buildAttendancePayload('NO', 'b1'))

    expect(bookings.cancel).toHaveBeenCalledWith(CLUB, 'b1', { attendanceDeclined: true })
    expect(notifications.notifyClub).toHaveBeenCalledWith(
      CLUB,
      expect.objectContaining({ title: expect.stringContaining('Juan Pérez no viene') }),
    )
    expect(reply).toContain('Liberamos tu turno')
    expect(reply).toContain('Tu turno fijo sigue igual')
  })

  it('a second "No puedo" doesn\'t release anything again', async () => {
    const { service, bookings, notifications } = setup(fijoRow({ status: 'CANCELLED', attendanceConfirmed: false }))

    const reply = await service.handleButtonReply(CLUB, WA_ID, buildAttendancePayload('NO', 'b1'))

    expect(bookings.cancel).not.toHaveBeenCalled()
    expect(notifications.notifyClub).not.toHaveBeenCalled()
    expect(reply).toContain('quedó liberado')
  })

  it('a "No puedo" that lost the race against another release still answers kindly', async () => {
    const { service, bookings, notifications } = setup()
    bookings.cancel.mockRejectedValue(new BadRequestException('La reserva ya fue cancelada'))

    const reply = await service.handleButtonReply(CLUB, WA_ID, buildAttendancePayload('NO', 'b1'))

    expect(reply).toContain('quedó liberado')
    expect(notifications.notifyClub).not.toHaveBeenCalled()
  })

  it('"Sí, voy" after "No puedo" doesn\'t take the court back (it may be someone else\'s)', async () => {
    const { service, bookings } = setup(fijoRow({ status: 'CANCELLED', attendanceConfirmed: false }))

    const reply = await service.handleButtonReply(CLUB, WA_ID, buildAttendancePayload('YES', 'b1'))

    expect(bookings.confirmAttendance).not.toHaveBeenCalled()
    expect(reply).toContain('Habías avisado que no venías')
  })

  it('"No puedo" after "Sí, voy" still releases: plans change, and early is better for the club', async () => {
    const { service, bookings } = setup(fijoRow({ attendanceConfirmed: true }))

    await service.handleButtonReply(CLUB, WA_ID, buildAttendancePayload('NO', 'b1'))

    expect(bookings.cancel).toHaveBeenCalledWith(CLUB, 'b1', { attendanceDeclined: true })
  })

  it('does nothing for a turno that already started', async () => {
    const startsAt = inHours(-1)
    const { service, bookings } = setup(fijoRow({ slot: { ...fijoRow().slot, startsAt, endsAt: inHours(0.5) } }))

    const reply = await service.handleButtonReply(CLUB, WA_ID, buildAttendancePayload('NO', 'b1'))

    expect(bookings.cancel).not.toHaveBeenCalled()
    expect(reply).toContain('ya pasó')
  })
})

describe('"No puedo" → release → waitlist (real BookingsService and WaitlistService)', () => {
  /** Lets the waitlist's fire-and-forget broadcast run to completion. */
  const flush = () => new Promise(resolve => setImmediate(resolve))

  it('frees only that occurrence and offers the court to the day’s waitlist', async () => {
    const row = fijoRow()
    const tx = {
      booking: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ ...row, status: 'CANCELLED', attendanceConfirmed: false }),
      },
      slot: { update: jest.fn().mockResolvedValue({}) },
      player: { update: jest.fn() },
    }
    const prisma = {
      booking: { findFirst: jest.fn().mockResolvedValue(row) },
      recurringBooking: { update: jest.fn(), delete: jest.fn() },
      waitlistEntry: {
        findMany: jest.fn().mockResolvedValue([{ id: 'w1', waId: '5493417777777', playerName: 'Ana' }]),
        update: jest.fn().mockResolvedValue({}),
      },
      whatsAppLine: { findFirst: jest.fn().mockResolvedValue({ phoneNumberId: 'line-1' }) },
      conversationSession: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    }
    const events = new BookingEventsService()
    const whatsapp = { sendText: jest.fn().mockResolvedValue(true) }
    const waitlist = new WaitlistService(
      prisma as never,
      whatsapp as never,
      events,
      {} as never,
      {
        botPaused: jest.fn().mockResolvedValue(false),
      } as never,
    )
    waitlist.onModuleInit()

    // Reflect.construct keeps this test independent of how many collaborators BookingsService
    // takes: only the ones the cancellation touches are real here.
    const bookings = Reflect.construct(BookingsService, [
      prisma,
      events,
      {},
      { notifyClub: jest.fn() },
      {},
      { repriceSlot: jest.fn().mockResolvedValue(2_000_000) },
      {},
    ]) as BookingsService
    const service = new FixedConfirmationsService(
      prisma as never,
      bookings,
      { notifyClub: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never,
      { botPaused: jest.fn().mockResolvedValue(false) } as never,
    )

    await service.handleButtonReply(CLUB, WA_ID, buildAttendancePayload('NO', 'b1'))
    await flush()
    await flush()

    // The occurrence is cancelled as a decline, conditional on it still being CONFIRMED…
    expect(tx.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'b1', status: 'CONFIRMED' },
      data: expect.objectContaining({ status: 'CANCELLED', attendanceConfirmed: false }),
    })
    expect(tx.slot.update).toHaveBeenCalledWith({ where: { id: 'slot-1' }, data: { status: 'AVAILABLE' } })
    // …while the RecurringBooking itself is never touched: next week is still theirs.
    expect(prisma.recurringBooking.update).not.toHaveBeenCalled()
    expect(prisma.recurringBooking.delete).not.toHaveBeenCalled()
    // The freed court reached the waitlist like any other cancellation.
    expect(whatsapp.sendText).toHaveBeenCalledWith(
      'line-1',
      '5493417777777',
      expect.stringContaining('se liberó un turno que esperabas'),
    )

    waitlist.onModuleDestroy()
  })
})

describe('FixedConfirmationsService.askUpcoming', () => {
  function askSetup(delivered: boolean, paused = false) {
    const prisma = {
      club: { findMany: jest.fn().mockResolvedValue([{ id: CLUB, fixedConfirmationLeadHours: 24 }]) },
      booking: {
        findMany: jest.fn().mockResolvedValue([fijoRow({ slot: { ...fijoRow().slot, startsAt: inHours(24) } })]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const whatsapp = { sendTemplate: jest.fn().mockResolvedValue(delivered) }
    const lines = { findActiveForClub: jest.fn().mockResolvedValue({ phoneNumberId: 'line-1' }) }
    const credits = { botPaused: jest.fn().mockResolvedValue(paused) }
    const service = new FixedConfirmationsService(
      prisma as never,
      {} as never,
      {} as never,
      whatsapp as never,
      lines as never,
      credits as never,
    )
    return { service, prisma, whatsapp, credits }
  }

  it('sends the template with one payload per button naming the booking, then stamps it', async () => {
    const { service, prisma, whatsapp } = askSetup(true)

    await service.askUpcoming()

    expect(whatsapp.sendTemplate).toHaveBeenCalledWith(
      'line-1',
      WA_ID,
      expect.any(String),
      expect.any(String),
      ['Juan Pérez', expect.any(String), expect.stringMatching(/^\d{2}:\d{2}$/), 'Cancha 1'],
      ['FIJO:YES:b1', 'FIJO:NO:b1'],
    )
    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'b1', attendanceAskedAt: null },
      data: { attendanceAskedAt: expect.any(Date) },
    })
  })

  it('leaves the fijo unasked when Meta refuses the message, so the 1h reminder still goes', async () => {
    const { service, prisma } = askSetup(false)

    await service.askUpcoming()

    expect(prisma.booking.updateMany).not.toHaveBeenCalled()
  })

  it('asks nothing while the bot is paused for credits', async () => {
    const { service, whatsapp } = askSetup(true, true)

    await service.askUpcoming()

    expect(whatsapp.sendTemplate).not.toHaveBeenCalled()
  })
})
