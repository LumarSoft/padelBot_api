import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, SlotStatus } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { isUniqueConstraintError } from '../prisma/prisma-errors'
import { shiftDateKey, todayKey, toDateKey, wallTimeToUtc, weekdayOfKey } from '../availability/lib/datetime'
import {
  bandDateTimes,
  bandsForWeekday,
  courtScheduleSelect,
  findBandInSchedule,
  ScheduleBand,
} from '../availability/lib/schedule'
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
  untilDate: true,
  isActive: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  court: { select: { id: true, name: true } },
} as const

/** Default number of upcoming weekly occurrences to book when no end date is set. */
const WEEKS_AHEAD = 8
/** Safety cap on how many weekly occurrences a single end-dated recurring booking can block. */
const MAX_WEEKS_AHEAD = 104

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
    // Validate against the schedule of the chosen weekday (opening hours can differ per day).
    const band = this.assertValidSlotPair(bandsForWeekday(court, dto.dayOfWeek), dto.slotStart, dto.slotEnd)

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
        untilDate: dto.untilDate ? wallTimeToUtc(dto.untilDate, '00:00') : null,
        createdByUserId,
      },
      select: recurringBookingSelect,
    })

    await this.applyForWeeksAhead(
      clubId,
      rb.id,
      {
        courtId: dto.courtId,
        dayOfWeek: dto.dayOfWeek,
        playerName: dto.playerName,
        playerPhone: dto.playerPhone,
        priceCents: dto.priceCents,
      },
      band,
      dto.untilDate,
    )

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
    if (!rb.isActive) throw new BadRequestException('El turno fijo está inactivo')

    // The court's schedule may have changed since the recurring was created — re-derive
    // the band from today's config and fail clearly if the time no longer exists.
    const court = await this.assertCourtBelongsToClub(clubId, rb.courtId)
    const band = this.assertValidSlotPair(bandsForWeekday(court, rb.dayOfWeek), rb.slotStart, rb.slotEnd)

    const applied = await this.applyForWeeksAhead(
      clubId,
      id,
      {
        courtId: rb.courtId,
        dayOfWeek: rb.dayOfWeek,
        playerName: rb.playerName,
        playerPhone: rb.playerPhone,
        priceCents: rb.priceCents,
      },
      band,
      rb.untilDate ? toDateKey(rb.untilDate) : undefined,
    )

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
    dto: Pick<CreateRecurringBookingDto, 'courtId' | 'dayOfWeek' | 'playerName' | 'playerPhone' | 'priceCents'>,
    band: ScheduleBand,
    untilKey?: string,
  ): Promise<number> {
    const occurrences = this.nextOccurrences(dto.dayOfWeek, band, untilKey)
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

    // An occurrence whose booking was CANCELLED was deliberately skipped ("el fijo no
    // viene ESTE martes") — never re-book it on the next apply/weekly sweep.
    const skipped = await this.prisma.booking.findMany({
      where: {
        clubId,
        recurringBookingId,
        status: 'CANCELLED',
        slot: { startsAt: { gte: minStart, lte: maxStart } },
      },
      select: { slot: { select: { startsAt: true } } },
    })
    const skippedKeys = new Set(skipped.map(b => b.slot.startsAt.toISOString()))

    const toCreate: Prisma.SlotCreateManyInput[] = []
    const toBook: string[] = [] // IDs of AVAILABLE slots to flip to BOOKED

    for (const occ of occurrences) {
      const key = occ.startsAt.toISOString()
      if (skippedKeys.has(key)) continue
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
          throw new ConflictException('Conflicto de turnos simultáneo, volvé a intentar')
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

    // Create a Booking record for each newly-booked slot. Fixed (recurring) turns are
    // CONFIRMED on creation — they are blocked by the club, NOT a pending-payment flow, so
    // they never show up as a "pago por confirmar" and never expire.
    await this.prisma.$transaction(
      allSlotIds.map(slotId =>
        this.prisma.booking.create({
          data: {
            slotId,
            clubId,
            playerName: dto.playerName,
            playerPhone: dto.playerPhone,
            recurringBookingId,
            status: 'CONFIRMED',
          },
        }),
      ),
    )

    return allSlotIds.length
  }

  /**
   * Computes the upcoming weekly occurrences of `targetDay` starting from today
   * (today is included if it matches). With `untilKey` ("YYYY-MM-DD") it generates
   * every weekly occurrence up to and including that club-local day (capped at
   * MAX_WEEKS_AHEAD as a safety bound); without it, the default rolling window of
   * WEEKS_AHEAD occurrences. Weekday matching and the wall-clock band are anchored to
   * the club timezone, so the stored UTC instants match slots created elsewhere.
   */
  private nextOccurrences(
    targetDay: number,
    band: ScheduleBand,
    untilKey?: string,
  ): { startsAt: Date; endsAt: Date }[] {
    const results: { startsAt: Date; endsAt: Date }[] = []

    // Advance to the next occurrence of targetDay (today counts if it matches).
    const todayDay = weekdayOfKey(todayKey())
    const daysUntil = (targetDay - todayDay + 7) % 7
    let cursorKey = shiftDateKey(todayKey(), daysUntil)

    const maxIterations = untilKey ? MAX_WEEKS_AHEAD : WEEKS_AHEAD

    for (let i = 0; i < maxIterations; i++) {
      // ISO date keys compare correctly as strings — stop once we pass the end date.
      if (untilKey && cursorKey > untilKey) break

      // The band carries its own day offsets (a late band can start or end past midnight).
      results.push(bandDateTimes(cursorKey, band))
      cursorKey = shiftDateKey(cursorKey, 7)
    }

    return results
  }

  private assertValidSlotPair(bands: ScheduleBand[], slotStart: string, slotEnd: string): ScheduleBand {
    const band = findBandInSchedule(bands, slotStart)
    if (!band || band.end !== slotEnd) {
      throw new BadRequestException(`El horario ${slotStart} – ${slotEnd} no existe en la grilla de esa cancha ese día`)
    }
    return band
  }

  private async assertCourtBelongsToClub(clubId: string, courtId: string) {
    const court = await this.prisma.court.findFirst({
      where: { id: courtId, clubId },
      select: { id: true, ...courtScheduleSelect },
    })
    if (!court) {
      throw new BadRequestException(`Court ${courtId} not found for this club`)
    }
    return court
  }
}
