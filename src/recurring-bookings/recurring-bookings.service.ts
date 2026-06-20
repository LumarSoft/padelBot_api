import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, SlotStatus } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
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
    await this.assertCourtBelongsToClub(clubId, dto.courtId)
    this.assertValidSlotPair(dto.slotStart, dto.slotEnd)

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
      const created = await this.prisma.$transaction(
        toCreate.map(data => this.prisma.slot.create({ data, select: { id: true } })),
      )
      createdIds = created.map(s => s.id)
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
   * (today is included if it matches). Dates are built as local-time ISO strings
   * (no trailing Z) so they are treated the same way as slots created via
   * SlotsService.buildBand() – consistent with how the rest of the codebase
   * constructs slot datetimes.
   */
  private nextOccurrences(
    targetDay: number,
    slotStart: string,
    slotEnd: string,
    count: number,
  ): { startsAt: Date; endsAt: Date }[] {
    const results: { startsAt: Date; endsAt: Date }[] = []

    const cursor = new Date()
    cursor.setHours(0, 0, 0, 0)

    // Advance to the next occurrence of targetDay (today counts if it matches)
    const todayDay = cursor.getDay()
    const daysUntil = (targetDay - todayDay + 7) % 7
    cursor.setDate(cursor.getDate() + daysUntil)

    for (let i = 0; i < count; i++) {
      const yyyy = cursor.getFullYear()
      const mm = String(cursor.getMonth() + 1).padStart(2, '0')
      const dd = String(cursor.getDate()).padStart(2, '0')
      const dateStr = `${yyyy}-${mm}-${dd}`

      const startsAt = new Date(`${dateStr}T${slotStart}:00`)

      let endsAt: Date
      if (slotEnd === '00:00') {
        // 22:30–00:00 band ends at midnight the following day
        const nextDay = new Date(cursor)
        nextDay.setDate(nextDay.getDate() + 1)
        const ny = nextDay.getFullYear()
        const nm = String(nextDay.getMonth() + 1).padStart(2, '0')
        const nd = String(nextDay.getDate()).padStart(2, '0')
        endsAt = new Date(`${ny}-${nm}-${nd}T00:00:00`)
      } else {
        endsAt = new Date(`${dateStr}T${slotEnd}:00`)
      }

      results.push({ startsAt, endsAt })
      cursor.setDate(cursor.getDate() + 7)
    }

    return results
  }

  private assertValidSlotPair(slotStart: string, slotEnd: string): void {
    const PAIRS: [string, string][] = [
      ['09:00', '10:30'],
      ['10:30', '12:00'],
      ['12:00', '13:30'],
      ['13:30', '15:00'],
      ['15:00', '16:30'],
      ['16:30', '18:00'],
      ['18:00', '19:30'],
      ['19:30', '21:00'],
      ['21:00', '22:30'],
      ['22:30', '00:00'],
    ]
    const valid = PAIRS.some(([s, e]) => s === slotStart && e === slotEnd)
    if (!valid) {
      throw new BadRequestException(`Invalid slot pair: ${slotStart} – ${slotEnd}`)
    }
  }

  private async assertCourtBelongsToClub(clubId: string, courtId: string): Promise<void> {
    const court = await this.prisma.court.findFirst({
      where: { id: courtId, clubId },
      select: { id: true },
    })
    if (!court) {
      throw new BadRequestException(`Court ${courtId} not found for this club`)
    }
  }
}
