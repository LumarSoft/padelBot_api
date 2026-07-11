import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, SlotStatus } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { isUniqueConstraintError } from '../prisma/prisma-errors'
import { bandDateTimes, bandsForDate, courtScheduleSelect, findBandInSchedule } from '../availability/lib/schedule'
import { shiftDateKey } from '../availability/lib/datetime'
import { CreateSlotDto } from './dto/create-slot.dto'
import { UpdateSlotDto } from './dto/update-slot.dto'
import { QuerySlotsDto } from './dto/query-slots.dto'
import { BulkBlockSlotsDto } from './dto/bulk-block-slots.dto'

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
      throw new NotFoundException(`Turno no encontrado`)
    }
    return slot
  }

  async create(clubId: string, dto: CreateSlotDto) {
    const startsAt = new Date(dto.startsAt)
    const endsAt = new Date(dto.endsAt)
    this.assertValidRange(startsAt, endsAt)
    await this.assertCourtBelongsToClub(clubId, dto.courtId)

    try {
      return await this.prisma.slot.create({
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
    } catch (error) {
      // The unique index on (courtId, startsAt) already holds a slot for this
      // court and time — likely created concurrently by the bot.
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('Ya existe un turno para esta cancha en ese horario')
      }
      throw error
    }
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
      select: { id: true, priceCents: true, ...courtScheduleSelect },
    })
    if (courts.length !== courtIds.length) {
      throw new BadRequestException('Una o más canchas no pertenecen a este complejo')
    }
    const priceByCourt = new Map(courts.map(c => [c.id, c.priceCents]))

    const dates = this.enumerateDates(dto.fromDate, dto.toDate)

    const targets: { courtId: string; startsAt: Date; endsAt: Date }[] = []
    for (const date of dates) {
      for (const court of courts) {
        // Bands depend on the date's weekday (per-day opening hours).
        const courtBands = bandsForDate(court, date)
        const starts =
          dto.slotStarts && dto.slotStarts.length > 0
            ? dto.slotStarts.filter(s => courtBands.some(b => b.start === s))
            : courtBands.map(b => b.start)
        for (const start of starts) {
          const band = findBandInSchedule(courtBands, start)
          if (!band) continue
          const { startsAt, endsAt } = bandDateTimes(date, band)
          targets.push({ courtId: court.id, startsAt, endsAt })
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
      // skipDuplicates: if a slot for any target (courtId, startsAt) was created
      // concurrently after our findMany above, the unique index would otherwise
      // abort the whole bulk insert — INSERT IGNORE skips those rows instead.
      ...(toCreate.length ? [this.prisma.slot.createMany({ data: toCreate, skipDuplicates: true })] : []),
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
    const start = from.slice(0, 10)
    const end = to.slice(0, 10)
    // Validate as real calendar dates without pulling in the server timezone.
    if (Number.isNaN(Date.parse(`${start}T00:00:00Z`)) || Number.isNaN(Date.parse(`${end}T00:00:00Z`))) {
      throw new BadRequestException('Rango de fechas inválido')
    }
    if (end < start) {
      throw new BadRequestException('La fecha hasta debe ser igual o posterior a la fecha desde')
    }
    const dates: string[] = []
    let cursor = start
    while (cursor <= end) {
      dates.push(cursor)
      cursor = shiftDateKey(cursor, 1)
    }
    return dates
  }

  private assertValidRange(startsAt: Date, endsAt: Date): void {
    if (endsAt <= startsAt) {
      throw new BadRequestException('La hora de fin debe ser posterior a la de inicio')
    }
  }

  private async assertCourtBelongsToClub(clubId: string, courtId: string): Promise<void> {
    const court = await this.prisma.court.findFirst({
      where: { id: courtId, clubId },
      select: { id: true },
    })
    if (!court) {
      throw new BadRequestException(`Cancha no encontrada en este complejo`)
    }
  }
}
