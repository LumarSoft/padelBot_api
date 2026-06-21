import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, SlotStatus } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { isUniqueConstraintError } from '../prisma/prisma-errors'
import { shiftDateKey, todayKey, wallTimeToUtc, weekdayOfKey } from '../availability/lib/datetime'
import { findBandInSchedule, generateBands } from '../availability/lib/schedule'
import { CreateRecurringBookingDto } from './dto/create-recurring-booking.dto'
import { UpdateRecurringBookingDto } from './dto/update-recurring-booking.dto'

const recurringBookingSelect = {
  id: true,
  clubId: true,
  courtId: true,
  dayOfWeek: true,
  slotStart: true,
  slotEnd: true,
  playerName: true,
  playerPhone: true,
  priceCents: true,
  notes: true,
  isActive: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  court: { select: { id: true, name: true } },
} as const

/** Number of upcoming weekly occurrences to book when a recurring booking is created / applied. */
const WEEKS_AHEAD = 8

@Injectable()
export class RecurringBookingsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(clubId: string) {
    return this.prisma.recurringBooking.findMany({
      where: { clubId },
      select: recurringBookingSelect,
      orderBy: [{ dayOfWeek: 'asc' }, { slotStart: 'asc' }],
    })
  }

  async findOne(clubId: string, id: string) {
    const rb = await this.prisma.recurringBooking.findFirst({
      where: { id, clubId },
      select: recurringBookingSelect,
    })
    if (!rb) throw new NotFoundException(`RecurringBooking ${id} not found`)
    return rb
  }

  async create(clubId: string, createdByUserId: number, dto: CreateRecurringBookingDto) {
    const court = await this.assertCourtBelongsToClub(clubId, dto.courtId)
    this.assertValidSlotPair(generateBands(court.openTime, court.closeTime), dto.slotStart, dto.slotEnd)

    const rb = await this.prisma.recurringBooking.create({
      data: {
        clubId,
        courtId: dto.courtId,
        dayOfWeek: dto.dayOfWeek,
        slotStart: dto.slotStart,
        slotEnd: dto.slotEnd,
        playerName: dto.playerName,
        playerPhone: dto.playerPhone,
        priceCents: dto.priceCents,
        notes: dto.notes,
        createdByUserId,
      },
      select: recurringBookingSelect,
    })

    await this.applyForWeeksAhead(clubId, rb.id, {
      courtId: dto.courtId,
      dayOfWeek: dto.dayOfWeek,
      slotStart: dto.slotStart,
      slotEnd: dto.slotEnd,
      playerName: dto.playerName,
      playerPhone: dto.playerPhone,
      priceCents: dto.priceCents,
    })

    return rb
  }

  async update(clubId: string, id: string, dto: UpdateRecurringBookingDto) {
    await this.findOne(clubId, id)
    return this.prisma.recurringBooking.update({
      where: { id },
      data: dto,
      select: recurringBookingSelect,
    })
  }

  async remove(clubId: string, id: string) {
    await this.findOne(clubId, id)
    await this.prisma.recurringBooking.delete({ where: { id } })
  }

  async applyToExistingSlots(clubId: string, id: string) {
    const rb = await this.findOne(clubId, id)
    if (!rb.isActive) throw new BadRequestException('Recurring booking is inactive')

    const applied = await this.applyForWeeksAhead(clubId, id, {
      courtId: rb.courtId,
      dayOfWeek: rb.dayOfWeek,
      slotStart: rb.slotStart,
      slotEnd: rb.slotEnd,
      playerName: rb.playerName,
      playerPhone: rb.playerPhone,
      priceCents: rb.priceCents,
    })

    return { applied }
  }

  /**
   * For each of the next WEEKS_AHEAD occurrences of `dayOfWeek` starting from
   * today, ensures a BOOKED slot + a Booking record exist.
   *
   * Logic per occurrence:
   * - Slot missing  → create it as BOOKED, then create a Booking
   * - Slot AVAILABLE → flip to BOOKED, then create a Booking
   * - Slot BOOKED / BLOCKED → skip (occupied by someone else or already done)
   */
  private async applyForWeeksAhead(
    clubId: string,
    recurringBookingId: string,
    dto: Pick<
      CreateRecurringBookingDto,
      'courtId' | 'dayOfWeek' | 'slotStart' | 'slotEnd' | 'playerName' | 'playerPhone' | 'priceCents'
    >,
  ): Promise<number> {
    const occurrences = this.nextOccurrences(dto.dayOfWeek, dto.slotStart, dto.slotEnd, WEEKS_AHEAD)
    if (occurrences.length === 0) return 0

    const minStart = occurrences[0].startsAt
    const maxStart = occurrences[occurrences.length - 1].startsAt

    // Load any existing slots in the target window for this court
    const existing = await this.prisma.slot.findMany({
      where: {
        clubId,
        courtId: dto.courtId,
        startsAt: { gte: minStart, lte: maxStart },
      },
      select: { id: true, startsAt: true, status: true },
    })

    const existingByKey = new Map(existing.map(s => [s.startsAt.toISOString(), s]))

    const toCreate: Prisma.SlotCreateManyInput[] = []
    const toBook: string[] = [] // IDs of AVAILABLE slots to flip to BOOKED

    for (const occ of occurrences) {
      const key = occ.startsAt.toISOString()
      const found = existingByKey.get(key)

      if (!found) {
        toCreate.push({
          clubId,
          courtId: dto.courtId,
          startsAt: occ.startsAt,
          endsAt: occ.endsAt,
          priceCents: dto.priceCents,
          status: SlotStatus.BOOKED,
        })
      } else if (found.status === SlotStatus.AVAILABLE) {
        toBook.push(found.id)
      }
      // BOOKED / BLOCKED → skip silently
    }

    // Create missing slots one-by-one (MySQL's createMany doesn't return IDs)
    let createdIds: string[] = []
    if (toCreate.length > 0) {
      try {
        const created = await this.prisma.$transaction(
          toCreate.map(data => this.prisma.slot.create({ data, select: { id: true } })),
        )
        createdIds = created.map(s => s.id)
      } catch (error) {
        // A slot for one of these occurrences was created concurrently (admin or
        // bot) after our findMany. The unique index on (courtId, startsAt) rolls
        // the batch back — surface a retryable conflict instead of a raw 500.
        if (isUniqueConstraintError(error)) {
          throw new ConflictException('A conflicting slot was created concurrently; please retry')
        }
        throw error
      }
    }

    // Flip AVAILABLE → BOOKED
    if (toBook.length > 0) {
      await this.prisma.slot.updateMany({
        where: { id: { in: toBook } },
        data: { status: SlotStatus.BOOKED },
      })
    }

    const allSlotIds = [...createdIds, ...toBook]
    if (allSlotIds.length === 0) return 0

    // Create a Booking record for each newly-booked slot
    await this.prisma.$transaction(
      allSlotIds.map(slotId =>
        this.prisma.booking.create({
          data: {
            slotId,
            clubId,
            playerName: dto.playerName,
            playerPhone: dto.playerPhone,
            recurringBookingId,
          },
        }),
      ),
    )

    return allSlotIds.length
  }

  /**
   * Computes the next `count` occurrences of `targetDay` starting from today
   * (today is included if it matches). Both the weekday matching and the
   * wall-clock band are anchored to the club timezone, so the stored UTC instants
   * match slots created via SlotsService.buildBand() and the admin panel,
   * regardless of the server's timezone.
   */
  private nextOccurrences(
    targetDay: number,
    slotStart: string,
    slotEnd: string,
    count: number,
  ): { startsAt: Date; endsAt: Date }[] {
    const results: { startsAt: Date; endsAt: Date }[] = []

    // Advance to the next occurrence of targetDay (today counts if it matches).
    const todayDay = weekdayOfKey(todayKey())
    const daysUntil = (targetDay - todayDay + 7) % 7
    let cursorKey = shiftDateKey(todayKey(), daysUntil)

    for (let i = 0; i < count; i++) {
      const startsAt = wallTimeToUtc(cursorKey, slotStart)
      // The 22:30–00:00 band ends at midnight of the following day.
      const endsAt =
        slotEnd === '00:00' ? wallTimeToUtc(shiftDateKey(cursorKey, 1), '00:00') : wallTimeToUtc(cursorKey, slotEnd)

      results.push({ startsAt, endsAt })
      cursorKey = shiftDateKey(cursorKey, 7)
    }

    return results
  }

  private assertValidSlotPair(bands: ReturnType<typeof generateBands>, slotStart: string, slotEnd: string): void {
    const band = findBandInSchedule(bands, slotStart)
    if (!band || band.end !== slotEnd) {
      throw new BadRequestException(`Invalid slot pair: ${slotStart} – ${slotEnd}`)
    }
  }

  private async assertCourtBelongsToClub(clubId: string, courtId: string) {
    const court = await this.prisma.court.findFirst({
      where: { id: courtId, clubId },
      select: { id: true, openTime: true, closeTime: true },
    })
    if (!court) {
      throw new BadRequestException(`Court ${courtId} not found for this club`)
    }
    return court
  }
}
