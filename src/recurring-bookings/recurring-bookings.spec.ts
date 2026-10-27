import { ConflictException } from '@nestjs/common'
import { Prisma } from 'generated/prisma/client'
import { RecurringBookingsService } from './recurring-bookings.service'
import { bandsForWeekday } from '../availability/lib/schedule'

/**
 * A turno fijo ("todos los viernes 09:00, Martínez") books the next weeks of its band in one
 * sweep. It reads the court's slots first, but that read is NOT a guard: between the read and
 * the write a player can take one of those bands on WhatsApp. These tests pin the rule that the
 * sweep must respect, the same one the single-booking path respects: a band holds at most one
 * active booking. The fijo only books what it actually took at write time.
 */

const court = {
  id: 'court-1',
  openTime: '09:00',
  closeTime: '23:00',
  slotDurationMinutes: 90,
  weeklyHours: null,
}

const FRIDAY = 5

const fijo = {
  id: 'rb-1',
  clubId: 'club-1',
  courtId: 'court-1',
  dayOfWeek: FRIDAY,
  slotStart: '09:00',
  slotEnd: '10:30',
  playerName: 'Martínez',
  playerPhone: '5493411234567',
  priceCents: 20000,
  notes: null,
  untilDate: null,
  isActive: true,
}

function uniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  })
}

/** `lost` = slot ids another booker flipped to BOOKED between our read and our write. */
function setup(existing: { id: string; startsAt: Date; status: string }[], lost: string[] = []) {
  let created = 0
  const tx = {
    slot: {
      create: jest.fn(async () => ({ id: `new-${created++}` })),
      updateMany: jest.fn(async (args: { where: { id: string } }) => ({
        count: lost.includes(args.where.id) ? 0 : 1,
      })),
    },
    booking: { create: jest.fn(async () => ({})) },
  }
  const prisma = {
    recurringBooking: { findFirst: jest.fn().mockResolvedValue(fijo) },
    court: { findFirst: jest.fn().mockResolvedValue(court) },
    slot: { findMany: jest.fn().mockResolvedValue(existing) },
    booking: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
  }
  const service = new RecurringBookingsService(prisma as never, { repriceFutureSlots: jest.fn() } as never)
  return { service, prisma, tx }
}

/** The weekly occurrences the sweep targets (same computation the service uses). */
function occurrences(service: RecurringBookingsService) {
  const band = bandsForWeekday(court, FRIDAY).find(b => b.start === '09:00')!
  return (service as unknown as { nextOccurrences: (d: number, b: unknown) => { startsAt: Date }[] }).nextOccurrences(
    FRIDAY,
    band,
  )
}

describe('RecurringBookingsService — turno fijo sweep', () => {
  it('books only the bands it actually takes and skips one lost to a concurrent booking', async () => {
    const probe = setup([])
    const occ = occurrences(probe.service)
    expect(occ).toHaveLength(8)

    // Week 1 looked AVAILABLE but a WhatsApp player takes it before our write (race lost);
    // week 2 is AVAILABLE and we win it; week 3 was already BOOKED; weeks 4–8 have no slot row.
    const existing = [
      { id: 's-lost', startsAt: occ[0].startsAt, status: 'AVAILABLE' },
      { id: 's-won', startsAt: occ[1].startsAt, status: 'AVAILABLE' },
      { id: 's-busy', startsAt: occ[2].startsAt, status: 'BOOKED' },
    ]
    const { service, tx } = setup(existing, ['s-lost'])

    const { applied } = await service.applyToExistingSlots('club-1', 'rb-1')

    // The take is a conditional update: the WHERE on status is the entire guarantee.
    expect(tx.slot.updateMany).toHaveBeenCalledWith({
      where: { id: 's-lost', clubId: 'club-1', status: 'AVAILABLE' },
      data: { status: 'BOOKED' },
    })

    const bookedSlotIds = tx.booking.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { data: { slotId: string } }).data.slotId,
    )
    expect(bookedSlotIds).not.toContain('s-lost') // never a second booking on a taken band
    expect(bookedSlotIds).not.toContain('s-busy')
    expect(bookedSlotIds).toContain('s-won')
    expect(tx.slot.create).toHaveBeenCalledTimes(5)
    expect(applied).toBe(6) // 5 new + 1 won
    expect(tx.booking.create).toHaveBeenCalledTimes(6)
    for (const call of tx.booking.create.mock.calls as unknown[][]) {
      expect((call[0] as { data: { status: string } }).data.status).toBe('CONFIRMED')
    }
  })

  it('surfaces a concurrent slot insert as a retryable Conflict, not a 500', async () => {
    const { service, tx } = setup([])
    tx.slot.create.mockRejectedValueOnce(uniqueConstraintError())

    await expect(service.applyToExistingSlots('club-1', 'rb-1')).rejects.toThrow(ConflictException)
    expect(tx.booking.create).not.toHaveBeenCalled()
  })

  it('never re-books an occurrence the club cancelled on purpose ("el fijo no viene este viernes")', async () => {
    const probe = setup([])
    const occ = occurrences(probe.service)
    const { service, prisma, tx } = setup([])
    // Week 2 was cancelled as an exception: its booking for this fijo is CANCELLED.
    prisma.booking.findMany.mockResolvedValue([{ slot: { startsAt: occ[1].startsAt } }])

    const { applied } = await service.applyToExistingSlots('club-1', 'rb-1')

    const createdStarts = (tx.slot.create.mock.calls as unknown[][]).map(c =>
      (c[0] as { data: { startsAt: Date } }).data.startsAt.toISOString(),
    )
    expect(createdStarts).not.toContain(occ[1].startsAt.toISOString())
    expect(applied).toBe(7)
  })

  it('does nothing when every band is already occupied', async () => {
    const probe = setup([])
    const occ = occurrences(probe.service)
    const existing = occ.map((o, i) => ({ id: `busy-${i}`, startsAt: o.startsAt, status: 'BOOKED' }))
    const { service, prisma } = setup(existing)

    const { applied } = await service.applyToExistingSlots('club-1', 'rb-1')

    expect(applied).toBe(0)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
