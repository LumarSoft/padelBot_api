import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateBookingDto } from './dto/create-booking.dto'
import { RescheduleBookingDto } from './dto/reschedule-booking.dto'
import { QueryBookingsDto } from './dto/query-bookings.dto'
import { SlotStatus } from 'generated/prisma/client'

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

@Injectable()
export class BookingsService {
  constructor(private readonly prisma: PrismaService) {}

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

    return updated
  }
}
