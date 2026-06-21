import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateBookingDto } from './dto/create-booking.dto'
import { RescheduleBookingDto } from './dto/reschedule-booking.dto'
import { QueryBookingsDto } from './dto/query-bookings.dto'
import { SlotStatus } from 'generated/prisma/client'
import { bandDateTimes, findBand } from '../availability/lib/schedule'
import { formatDayMonth, formatTimeRange } from '../availability/lib/datetime'
import { isUniqueConstraintError } from '../prisma/prisma-errors'
import { BookingAction, BookingEventsService } from '../events/booking-events.service'

/** Booking a schedule band that may not have a materialized Slot row yet. */
export interface BookBandInput {
  courtId: string
  dateKey: string
  bandStart: string
  playerName: string
  playerPhone?: string
  notes?: string
}

const bookingSelect = {
  id: true,
  slotId: true,
  clubId: true,
  playerName: true,
  playerPhone: true,
  status: true,
  notes: true,
  recurringBookingId: true,
  bookedByUserId: true,
  createdAt: true,
  updatedAt: true,
  slot: {
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      priceCents: true,
      status: true,
      court: { select: { id: true, name: true } },
    },
  },
} as const

/** Shape needed to build an event summary — satisfied by any `bookingSelect` row. */
type BookingForEvent = {
  clubId: string
  playerName: string
  slot: { startsAt: Date; endsAt: Date; court: { name: string } }
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: BookingEventsService,
  ) {}

  findAll(clubId: string, query: QueryBookingsDto) {
    return this.prisma.booking.findMany({
      where: {
        clubId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.playerPhone ? { playerPhone: query.playerPhone } : {}),
        ...(query.courtId || query.from || query.to
          ? {
              slot: {
                ...(query.courtId ? { courtId: query.courtId } : {}),
                ...(query.from || query.to
                  ? {
                      startsAt: {
                        ...(query.from ? { gte: new Date(query.from) } : {}),
                        ...(query.to ? { lte: new Date(query.to) } : {}),
                      },
                    }
                  : {}),
              },
            }
          : {}),
      },
      select: bookingSelect,
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(clubId: string, id: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id, clubId },
      select: bookingSelect,
    })
    if (!booking) throw new NotFoundException(`Booking ${id} not found`)
    return booking
  }

  async book(clubId: string, dto: CreateBookingDto, bookedByUserId?: number) {
    const slot = await this.prisma.slot.findFirst({
      where: { id: dto.slotId, clubId },
      select: { id: true, status: true },
    })
    if (!slot) throw new NotFoundException(`Slot ${dto.slotId} not found`)
    if (slot.status !== SlotStatus.AVAILABLE) {
      throw new ConflictException(`Slot ${dto.slotId} is not available`)
    }

    const [, booking] = await this.prisma.$transaction([
      this.prisma.slot.update({
        where: { id: dto.slotId },
        data: { status: SlotStatus.BOOKED },
      }),
      this.prisma.booking.create({
        data: {
          slotId: dto.slotId,
          clubId,
          playerName: dto.playerName,
          playerPhone: dto.playerPhone ?? null,
          notes: dto.notes,
          bookedByUserId: bookedByUserId ?? null,
        },
        select: bookingSelect,
      }),
    ])

    this.emitBookingChange('created', booking)
    return booking
  }

  /**
   * Books a schedule band under the open-by-default model. If the Slot row
   * doesn't exist yet it is materialized as BOOKED at the court's default price;
   * if it exists it must be AVAILABLE. Wrapped in an interactive transaction so
   * the availability check and the write are atomic.
   */
  async bookBand(clubId: string, input: BookBandInput) {
    const band = findBand(input.bandStart)
    if (!band) throw new BadRequestException(`Invalid slot band ${input.bandStart}`)

    const { startsAt, endsAt } = bandDateTimes(input.dateKey, band)
    if (startsAt.getTime() <= Date.now()) {
      throw new ConflictException('Cannot book a slot in the past')
    }

    const booking = await this.prisma.$transaction(async tx => {
      const existing = await tx.slot.findFirst({
        where: { clubId, courtId: input.courtId, startsAt },
        select: { id: true, status: true },
      })

      let slotId: string
      if (existing) {
        if (existing.status !== SlotStatus.AVAILABLE) {
          throw new ConflictException('Slot is not available')
        }
        await tx.slot.update({ where: { id: existing.id }, data: { status: SlotStatus.BOOKED } })
        slotId = existing.id
      } else {
        const court = await tx.court.findFirst({
          where: { id: input.courtId, clubId },
          select: { priceCents: true },
        })
        if (!court) throw new NotFoundException(`Court ${input.courtId} not found`)
        try {
          const slot = await tx.slot.create({
            data: {
              clubId,
              courtId: input.courtId,
              startsAt,
              endsAt,
              priceCents: court.priceCents,
              status: SlotStatus.BOOKED,
            },
            select: { id: true },
          })
          slotId = slot.id
        } catch (error) {
          // Another writer (admin panel or a concurrent bot turn) materialized
          // this exact slot between our lookup and insert. The unique index on
          // (courtId, startsAt) rejects the duplicate — the band is taken now.
          if (isUniqueConstraintError(error)) {
            throw new ConflictException('Slot is not available')
          }
          throw error
        }
      }

      return tx.booking.create({
        data: {
          slotId,
          clubId,
          playerName: input.playerName,
          playerPhone: input.playerPhone ?? null,
          notes: input.notes,
        },
        select: bookingSelect,
      })
    })

    this.emitBookingChange('created', booking)
    return booking
  }

  async cancel(clubId: string, id: string) {
    const booking = await this.findOne(clubId, id)
    if (booking.status === 'CANCELLED') {
      throw new BadRequestException('Booking is already cancelled')
    }

    const [, updated] = await this.prisma.$transaction([
      this.prisma.slot.update({
        where: { id: booking.slotId },
        data: { status: SlotStatus.AVAILABLE },
      }),
      this.prisma.booking.update({
        where: { id },
        data: { status: 'CANCELLED' },
        select: bookingSelect,
      }),
    ])

    this.emitBookingChange('cancelled', updated)
    return updated
  }

  async reschedule(clubId: string, id: string, dto: RescheduleBookingDto) {
    const booking = await this.findOne(clubId, id)
    if (booking.status === 'CANCELLED') {
      throw new BadRequestException('Cannot reschedule a cancelled booking')
    }
    if (booking.slotId === dto.newSlotId) {
      throw new BadRequestException('New slot must be different from the current slot')
    }

    const newSlot = await this.prisma.slot.findFirst({
      where: { id: dto.newSlotId, clubId },
      select: { id: true, status: true },
    })
    if (!newSlot) throw new NotFoundException(`Slot ${dto.newSlotId} not found`)
    if (newSlot.status !== SlotStatus.AVAILABLE) {
      throw new ConflictException(`Slot ${dto.newSlotId} is not available`)
    }

    const [, , updated] = await this.prisma.$transaction([
      this.prisma.slot.update({
        where: { id: booking.slotId },
        data: { status: SlotStatus.AVAILABLE },
      }),
      this.prisma.slot.update({
        where: { id: dto.newSlotId },
        data: { status: SlotStatus.BOOKED },
      }),
      this.prisma.booking.update({
        where: { id },
        data: { slotId: dto.newSlotId },
        select: bookingSelect,
      }),
    ])

    this.emitBookingChange('rescheduled', updated)
    return updated
  }

  /**
   * Broadcasts a booking change to the club's connected admins (live dashboard).
   * Best-effort: emitting never blocks or fails the booking itself.
   */
  private emitBookingChange(action: BookingAction, booking: BookingForEvent): void {
    const { startsAt, endsAt, court } = booking.slot
    this.events.emit({
      type: 'booking.changed',
      clubId: booking.clubId,
      action,
      summary: `${booking.playerName} · ${court.name} · ${formatDayMonth(startsAt)} · ${formatTimeRange(startsAt, endsAt)}`,
    })
  }
}
