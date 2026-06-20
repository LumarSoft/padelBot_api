import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, SlotStatus } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateSlotDto } from './dto/create-slot.dto'
import { UpdateSlotDto } from './dto/update-slot.dto'
import { QuerySlotsDto } from './dto/query-slots.dto'
import { BulkBlockSlotsDto } from './dto/bulk-block-slots.dto'

const SLOT_PAIRS: Record<string, string> = {
  '09:00': '10:30',
  '10:30': '12:00',
  '12:00': '13:30',
  '13:30': '15:00',
  '15:00': '16:30',
  '16:30': '18:00',
  '18:00': '19:30',
  '19:30': '21:00',
  '21:00': '22:30',
  '22:30': '00:00',
}

const slotSelect = {
  id: true,
  courtId: true,
  startsAt: true,
  endsAt: true,
  priceCents: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  court: { select: { id: true, name: true } },
} as const

@Injectable()
export class SlotsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(clubId: string, query: QuerySlotsDto) {
    const startsAt: Prisma.DateTimeFilter = {}
    if (query.from) startsAt.gte = new Date(query.from)
    if (query.to) startsAt.lte = new Date(query.to)

    return this.prisma.slot.findMany({
      where: {
        clubId,
        ...(query.courtId ? { courtId: query.courtId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.from || query.to ? { startsAt } : {}),
      },
      select: slotSelect,
      orderBy: { startsAt: 'asc' },
    })
  }

  async findOne(clubId: string, id: string) {
    const slot = await this.prisma.slot.findFirst({
      where: { id, clubId },
      select: slotSelect,
    })
    if (!slot) {
      throw new NotFoundException(`Slot ${id} not found`)
    }
    return slot
  }

  async create(clubId: string, dto: CreateSlotDto) {
    const startsAt = new Date(dto.startsAt)
    const endsAt = new Date(dto.endsAt)
    this.assertValidRange(startsAt, endsAt)
    await this.assertCourtBelongsToClub(clubId, dto.courtId)

    return this.prisma.slot.create({
      data: {
        clubId,
        courtId: dto.courtId,
        startsAt,
        endsAt,
        priceCents: dto.priceCents,
        status: dto.status,
      },
      select: slotSelect,
    })
  }

  async update(clubId: string, id: string, dto: UpdateSlotDto) {
    const existing = await this.findOne(clubId, id)

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : existing.startsAt
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : existing.endsAt
    this.assertValidRange(startsAt, endsAt)

    if (dto.courtId && dto.courtId !== existing.courtId) {
      await this.assertCourtBelongsToClub(clubId, dto.courtId)
    }

    return this.prisma.slot.update({
      where: { id },
      data: {
        courtId: dto.courtId,
        startsAt: dto.startsAt ? startsAt : undefined,
        endsAt: dto.endsAt ? endsAt : undefined,
        priceCents: dto.priceCents,
        status: dto.status,
      },
      select: slotSelect,
    })
  }

  async remove(clubId: string, id: string) {
    await this.findOne(clubId, id)
    await this.prisma.slot.delete({ where: { id } })
  }

  /**
   * Blocks many slots at once (e.g. a tournament): every selected court, for
   * every day in the range, on the chosen time bands. Missing slots are created
   * as BLOCKED; AVAILABLE slots are flipped to BLOCKED; BOOKED or already
   * BLOCKED slots are left untouched and counted as skipped.
   */
  async bulkBlock(
    clubId: string,
    dto: BulkBlockSlotsDto,
  ): Promise<{ blocked: number; created: number; skipped: number }> {
    const courtIds = [...new Set(dto.courtIds)]
    const courts = await this.prisma.court.findMany({
      where: { clubId, id: { in: courtIds } },
      select: { id: true, priceCents: true },
    })
    if (courts.length !== courtIds.length) {
      throw new BadRequestException('One or more courts do not belong to this club')
    }
    const priceByCourt = new Map(courts.map(c => [c.id, c.priceCents]))

    const starts = dto.slotStarts && dto.slotStarts.length > 0 ? dto.slotStarts : Object.keys(SLOT_PAIRS)
    const dates = this.enumerateDates(dto.fromDate, dto.toDate)

    const targets: { courtId: string; startsAt: Date; endsAt: Date }[] = []
    for (const date of dates) {
      for (const start of starts) {
        const { startsAt, endsAt } = this.buildBand(date, start)
        for (const courtId of courtIds) {
          targets.push({ courtId, startsAt, endsAt })
        }
      }
    }
    if (targets.length === 0) return { blocked: 0, created: 0, skipped: 0 }

    const minStart = new Date(Math.min(...targets.map(t => t.startsAt.getTime())))
    const maxStart = new Date(Math.max(...targets.map(t => t.startsAt.getTime())))
    const existing = await this.prisma.slot.findMany({
      where: { clubId, courtId: { in: courtIds }, startsAt: { gte: minStart, lte: maxStart } },
      select: { id: true, courtId: true, startsAt: true, status: true },
    })
    const keyOf = (courtId: string, startsAt: Date) => `${courtId}|${startsAt.toISOString()}`
    const existingByKey = new Map(existing.map(s => [keyOf(s.courtId, s.startsAt), s]))

    const toCreate: Prisma.SlotCreateManyInput[] = []
    const toBlockIds: string[] = []
    let skipped = 0
    for (const t of targets) {
      const found = existingByKey.get(keyOf(t.courtId, t.startsAt))
      if (!found) {
        toCreate.push({
          clubId,
          courtId: t.courtId,
          startsAt: t.startsAt,
          endsAt: t.endsAt,
          priceCents: priceByCourt.get(t.courtId) ?? 0,
          status: SlotStatus.BLOCKED,
        })
      } else if (found.status === SlotStatus.AVAILABLE) {
        toBlockIds.push(found.id)
      } else {
        skipped++
      }
    }

    await this.prisma.$transaction([
      ...(toCreate.length ? [this.prisma.slot.createMany({ data: toCreate })] : []),
      ...(toBlockIds.length
        ? [
            this.prisma.slot.updateMany({
              where: { id: { in: toBlockIds } },
              data: { status: SlotStatus.BLOCKED },
            }),
          ]
        : []),
    ])

    return { blocked: toCreate.length + toBlockIds.length, created: toCreate.length, skipped }
  }

  private enumerateDates(from: string, to: string): string[] {
    const start = new Date(`${from.slice(0, 10)}T00:00:00`)
    const end = new Date(`${to.slice(0, 10)}T00:00:00`)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date range')
    }
    if (end < start) {
      throw new BadRequestException('toDate must be on or after fromDate')
    }
    const dates: string[] = []
    const cursor = new Date(start)
    while (cursor <= end) {
      const y = cursor.getFullYear()
      const m = String(cursor.getMonth() + 1).padStart(2, '0')
      const d = String(cursor.getDate()).padStart(2, '0')
      dates.push(`${y}-${m}-${d}`)
      cursor.setDate(cursor.getDate() + 1)
    }
    return dates
  }

  private buildBand(date: string, start: string): { startsAt: Date; endsAt: Date } {
    const end = SLOT_PAIRS[start]
    const startsAt = new Date(`${date}T${start}:00`)
    let endsAt: Date
    if (end === '00:00') {
      endsAt = new Date(`${date}T00:00:00`)
      endsAt.setDate(endsAt.getDate() + 1)
    } else {
      endsAt = new Date(`${date}T${end}:00`)
    }
    return { startsAt, endsAt }
  }

  private assertValidRange(startsAt: Date, endsAt: Date): void {
    if (endsAt <= startsAt) {
      throw new BadRequestException('endsAt must be after startsAt')
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
