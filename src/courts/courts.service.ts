import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SlotPricingService } from '../pricing/slot-pricing.service'
import { parseWeeklyHours, WeeklyHours } from '../availability/lib/schedule'
import { todayKey } from '../availability/lib/datetime'
import { schedulerEnabled } from '../common/scheduling'
import { CreateCourtDto } from './dto/create-court.dto'
import { BulkPriceAdjustDto } from './dto/bulk-price-adjust.dto'
import { UpdateCourtDto } from './dto/update-court.dto'

const courtSelect = {
  id: true,
  name: true,
  priceCents: true,
  openTime: true,
  closeTime: true,
  slotDurationMinutes: true,
  weeklyHours: true,
  courtType: true,
  // The panel resolves a band's price client-side (agenda cells with no slot yet), so it
  // needs the same exceptions the bot uses — otherwise it quotes the default price.
  priceRules: { select: { dayOfWeek: true, startTime: true, priceCents: true } },
  createdAt: true,
  updatedAt: true,
} as const

@Injectable()
export class CourtsService {
  private readonly logger = new Logger(CourtsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly slotPricing: SlotPricingService,
  ) {}

  findAll(clubId: string) {
    return this.prisma.court.findMany({
      where: { clubId },
      select: courtSelect,
      orderBy: { name: 'asc' },
    })
  }

  async findOne(clubId: string, id: string) {
    const court = await this.prisma.court.findFirst({
      where: { id, clubId },
      select: courtSelect,
    })
    if (!court) {
      throw new NotFoundException(`Court ${id} not found`)
    }
    return court
  }

  create(clubId: string, dto: CreateCourtDto) {
    const weeklyHours = this.validateWeeklyHours(dto.weeklyHours)
    return this.prisma.court.create({
      data: {
        name: dto.name,
        priceCents: dto.priceCents,
        openTime: dto.openTime,
        closeTime: dto.closeTime,
        slotDurationMinutes: dto.slotDurationMinutes,
        weeklyHours: weeklyHours === null ? undefined : (weeklyHours as Prisma.InputJsonValue | undefined),
        courtType: dto.courtType,
        clubId,
      },
      select: courtSelect,
    })
  }

  async update(clubId: string, id: string, dto: UpdateCourtDto) {
    const before = await this.findOne(clubId, id)
    const weeklyHours = dto.weeklyHours === undefined ? undefined : this.validateWeeklyHours(dto.weeklyHours)
    const court = await this.prisma.court.update({
      where: { id },
      data: {
        name: dto.name,
        priceCents: dto.priceCents,
        openTime: dto.openTime,
        closeTime: dto.closeTime,
        slotDurationMinutes: dto.slotDurationMinutes,
        weeklyHours:
          weeklyHours === undefined
            ? undefined
            : weeklyHours === null
              ? Prisma.DbNull
              : (weeklyHours as Prisma.InputJsonValue),
        courtType: dto.courtType,
      },
      select: courtSelect,
    })

    // The new price must govern every turno still to be sold — otherwise the agenda keeps
    // quoting the old one on the slots that were already materialized.
    if (dto.priceCents !== undefined && dto.priceCents !== before.priceCents) {
      // Los fijos que estaban al precio de lista siguen a la lista; el que tiene un precio
      // negociado (distinto del de la cancha) se respeta — ese número es un acuerdo con el jugador.
      await this.prisma.recurringBooking.updateMany({
        where: { clubId, courtId: id, priceCents: before.priceCents },
        data: { priceCents: dto.priceCents },
      })
      await this.slotPricing.repriceFutureSlots(clubId, id)
    }
    return court
  }

  /**
   * Adjusts EVERY price of the club by a percentage in one shot — courts' default prices,
   * their per-band price rules, and the turnos fijos (a fijo left at last month's price is
   * money the club silently stops charging). In Argentina prices move monthly; doing it
   * court by court is guaranteed friction. Amounts round to the nearest $100 so the
   * bot keeps asking clean numbers. `dryRun` returns the preview without writing.
   */
  async bulkAdjustPrices(clubId: string, dto: BulkPriceAdjustDto) {
    if (dto.percent === 0) throw new BadRequestException('El porcentaje no puede ser 0')

    // A future effective date SCHEDULES the change ("desde el 1/8 sube 10%") — in
    // Argentina los aumentos se anuncian antes de que rijan. Applied by applyDueAdjustments.
    if (!dto.dryRun && dto.effectiveDate && dto.effectiveDate > todayKey()) {
      const scheduled = await this.prisma.scheduledPriceAdjustment.create({
        data: { clubId, percent: dto.percent, effectiveDateKey: dto.effectiveDate },
        select: { id: true, percent: true, effectiveDateKey: true },
      })
      return { applied: false, scheduled: true, ...scheduled, courts: [], priceRulesUpdated: 0 }
    }
    const factor = 1 + dto.percent / 100
    // Nearest $100 (10_000 cents), never below $0.
    const adjust = (cents: number) => Math.max(0, Math.round((cents * factor) / 10000) * 10000)

    const [courts, rules, recurring] = await Promise.all([
      this.prisma.court.findMany({
        where: { clubId },
        select: { id: true, name: true, priceCents: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.courtPriceRule.findMany({
        where: { clubId },
        select: { id: true, priceCents: true },
      }),
      this.prisma.recurringBooking.findMany({
        where: { clubId, isActive: true },
        select: { id: true, priceCents: true },
      }),
    ])

    const courtChanges = courts.map(c => ({
      id: c.id,
      name: c.name,
      beforeCents: c.priceCents,
      afterCents: adjust(c.priceCents),
    }))
    const ruleChanges = rules.map(r => ({ id: r.id, afterCents: adjust(r.priceCents) }))
    const recurringChanges = recurring.map(r => ({ id: r.id, afterCents: adjust(r.priceCents) }))

    if (!dto.dryRun) {
      await this.prisma.$transaction([
        ...courtChanges
          .filter(c => c.afterCents !== c.beforeCents)
          .map(c => this.prisma.court.update({ where: { id: c.id }, data: { priceCents: c.afterCents } })),
        ...ruleChanges.map(r =>
          this.prisma.courtPriceRule.update({ where: { id: r.id }, data: { priceCents: r.afterCents } }),
        ),
        ...recurringChanges.map(r =>
          this.prisma.recurringBooking.update({ where: { id: r.id }, data: { priceCents: r.afterCents } }),
        ),
      ])
      await this.slotPricing.repriceFutureSlots(clubId)
    }

    return {
      applied: !dto.dryRun,
      percent: dto.percent,
      courts: courtChanges,
      priceRulesUpdated: ruleChanges.length,
      recurringBookingsUpdated: recurringChanges.length,
    }
  }

  /** Pending scheduled adjustments (not yet applied), soonest first. */
  listScheduledAdjustments(clubId: string) {
    return this.prisma.scheduledPriceAdjustment.findMany({
      where: { clubId, appliedAt: null },
      select: { id: true, percent: true, effectiveDateKey: true, createdAt: true },
      orderBy: { effectiveDateKey: 'asc' },
    })
  }

  async removeScheduledAdjustment(clubId: string, id: string) {
    const { count } = await this.prisma.scheduledPriceAdjustment.deleteMany({
      where: { id, clubId, appliedAt: null },
    })
    if (count === 0) throw new NotFoundException('Aumento programado no encontrado')
  }

  /**
   * Applies scheduled price adjustments whose effective day arrived (club-local).
   * Runs shortly after midnight so the new prices govern the whole day. Idempotent:
   * appliedAt marks each one done, and a failure of one club never blocks the rest.
   */
  @Cron('10 0 * * *', { timeZone: process.env.CLUB_TIMEZONE ?? 'America/Argentina/Buenos_Aires' })
  async applyDueAdjustments(): Promise<void> {
    if (!schedulerEnabled()) return
    const due = await this.prisma.scheduledPriceAdjustment.findMany({
      where: { appliedAt: null, effectiveDateKey: { lte: todayKey() } },
      select: { id: true, clubId: true, percent: true, effectiveDateKey: true },
      orderBy: { effectiveDateKey: 'asc' },
    })
    for (const adjustment of due) {
      try {
        await this.bulkAdjustPrices(adjustment.clubId, { percent: adjustment.percent })
        await this.prisma.scheduledPriceAdjustment.update({
          where: { id: adjustment.id },
          data: { appliedAt: new Date() },
        })
        this.logger.log(
          `Applied scheduled price adjustment ${adjustment.percent}% for club ${adjustment.clubId} (${adjustment.effectiveDateKey})`,
        )
      } catch (err) {
        this.logger.error(`Failed scheduled price adjustment ${adjustment.id}`, err)
      }
    }
  }

  async remove(clubId: string, id: string) {
    await this.findOne(clubId, id)
    await this.prisma.court.delete({ where: { id } })
  }

  private validateWeeklyHours(value: WeeklyHours | null | undefined): WeeklyHours | null {
    try {
      return parseWeeklyHours(value)
    } catch (error) {
      throw new BadRequestException((error as Error).message)
    }
  }
}
