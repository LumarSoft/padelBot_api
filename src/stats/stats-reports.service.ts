import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { dayRangeUtc, shiftDateKey, todayKey, toDateKey, weekdayOfKey } from '../availability/lib/datetime'
import { bandDateTimes, bandsForDate, bandSortMinutes, courtScheduleSelect } from '../availability/lib/schedule'
import { schedulerEnabled } from '../common/scheduling'

/** Weeks of history the occupancy heatmap aggregates. */
const DEFAULT_HEATMAP_WEEKS = 4

export interface OccupancyCell {
  /** 0 = Sunday … 6 = Saturday (club-local). */
  weekday: number
  /** "HH:MM" band start. */
  bandStart: string
  offered: number
  occupied: number
}

export interface OccupancyReport {
  weeks: number
  fromDateKey: string
  toDateKey: string
  /** Distinct band starts in chronological order — the heatmap's rows. */
  bandStarts: string[]
  cells: OccupancyCell[]
}

export interface RevenueDay {
  dateKey: string
  depositCents: number
  productsCents: number
  /** Front-desk cash collected (modo mostrador). */
  cashCents: number
  /** Front-desk QR collected (the club's own QR, not MP-reconciled). */
  qrCents: number
  bookings: number
}

export interface RevenueReport {
  fromDateKey: string
  toDateKey: string
  totalDepositCents: number
  totalProductsCents: number
  totalCashCents: number
  totalQrCents: number
  totalBookings: number
  days: RevenueDay[]
}

@Injectable()
export class StatsReportsService {
  private readonly logger = new Logger(StatsReportsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Occupancy heatmap over the last N FULL weeks (ending yesterday): how taken each
   * (weekday × band) is across every court. This is the report that tells the owner
   * where to raise prices and where to run promos — "tus martes 15:00 están al 20%".
   */
  async getOccupancy(clubId: string, weeks = DEFAULT_HEATMAP_WEEKS): Promise<OccupancyReport> {
    const toKey = shiftDateKey(todayKey(), -1)
    const fromKey = shiftDateKey(toKey, -(weeks * 7 - 1))

    const courts = await this.prisma.court.findMany({
      where: { clubId },
      select: { id: true, ...courtScheduleSelect },
    })

    // One query for everything that occupied a slot in the window.
    const windowStart = dayRangeUtc(fromKey).gte
    const windowEnd = dayRangeUtc(shiftDateKey(toKey, 2)).gte
    const occupiedSlots = await this.prisma.slot.findMany({
      where: { clubId, status: 'BOOKED', startsAt: { gte: windowStart, lt: windowEnd } },
      select: { courtId: true, startsAt: true },
    })
    const occupiedKeys = new Set(occupiedSlots.map(s => `${s.courtId}|${s.startsAt.toISOString()}`))

    const byCell = new Map<string, OccupancyCell>()
    const bandMinutes = new Map<string, number>()
    for (let i = 0; i < weeks * 7; i++) {
      const dateKey = shiftDateKey(fromKey, i)
      const weekday = weekdayOfKey(dateKey)
      for (const court of courts) {
        for (const band of bandsForDate(court, dateKey)) {
          const key = `${weekday}|${band.start}`
          const cell = byCell.get(key) ?? { weekday, bandStart: band.start, offered: 0, occupied: 0 }
          cell.offered++
          const { startsAt } = bandDateTimes(dateKey, band)
          if (occupiedKeys.has(`${court.id}|${startsAt.toISOString()}`)) cell.occupied++
          byCell.set(key, cell)
          bandMinutes.set(band.start, bandSortMinutes(band))
        }
      }
    }

    const bandStarts = [...bandMinutes.entries()].sort((a, b) => a[1] - b[1]).map(([start]) => start)
    return { weeks, fromDateKey: fromKey, toDateKey: toKey, bandStarts, cells: [...byCell.values()] }
  }

  /**
   * Money per day in a date range: deposits actually collected (confirmed transfer
   * flow) and kiosk consumption. The panel renders it and exports it as CSV.
   */
  async getRevenue(clubId: string, fromKey: string, toKey: string): Promise<RevenueReport> {
    const from = dayRangeUtc(fromKey).gte
    const to = dayRangeUtc(shiftDateKey(toKey, 1)).gte

    const [bookings, products, playerPayments] = await Promise.all([
      this.prisma.booking.findMany({
        where: {
          clubId,
          status: 'CONFIRMED',
          slot: { startsAt: { gte: from, lt: to } },
        },
        select: {
          transferAmountCents: true,
          mpPaymentId: true,
          localPaymentCents: true,
          localPaymentMethod: true,
          slot: { select: { startsAt: true } },
        },
      }),
      this.prisma.bookingProduct.findMany({
        where: { clubId, booking: { slot: { startsAt: { gte: from, lt: to } } } },
        select: { quantity: true, unitPriceCents: true, booking: { select: { slot: { select: { startsAt: true } } } } },
      }),
      this.prisma.bookingPlayerPayment.findMany({
        where: { clubId, booking: { slot: { startsAt: { gte: from, lt: to } } } },
        select: { amountCents: true, method: true, booking: { select: { slot: { select: { startsAt: true } } } } },
      }),
    ])

    const byDay = new Map<string, RevenueDay>()
    const dayOf = (d: Date) => {
      const key = toDateKey(d)
      const entry = byDay.get(key) ?? {
        dateKey: key,
        depositCents: 0,
        productsCents: 0,
        cashCents: 0,
        qrCents: 0,
        bookings: 0,
      }
      byDay.set(key, entry)
      return entry
    }

    for (const b of bookings) {
      const entry = dayOf(b.slot.startsAt)
      entry.bookings++
      // Deposits actually collected through the transfer flow (a paid confirmation).
      if (b.transferAmountCents !== null && b.mpPaymentId !== null) entry.depositCents += b.transferAmountCents
      // Front-desk collections (modo mostrador) — the cash-closure side of the day.
      if (b.localPaymentMethod === 'CASH') entry.cashCents += b.localPaymentCents
      if (b.localPaymentMethod === 'QR') entry.qrCents += b.localPaymentCents
    }
    for (const p of products) {
      dayOf(p.booking.slot.startsAt).productsCents += p.quantity * p.unitPriceCents
    }
    // Per-player bill payments (cierre del turno). Declared transfers count with QR —
    // both are "mostrador digital" as opposed to cash in the drawer.
    for (const payment of playerPayments) {
      const entry = dayOf(payment.booking.slot.startsAt)
      if (payment.method === 'CASH') entry.cashCents += payment.amountCents
      else entry.qrCents += payment.amountCents
    }

    const days = [...byDay.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey))
    return {
      fromDateKey: fromKey,
      toDateKey: toKey,
      totalDepositCents: days.reduce((s, d) => s + d.depositCents, 0),
      totalProductsCents: days.reduce((s, d) => s + d.productsCents, 0),
      totalCashCents: days.reduce((s, d) => s + d.cashCents, 0),
      totalQrCents: days.reduce((s, d) => s + d.qrCents, 0),
      totalBookings: days.reduce((s, d) => s + d.bookings, 0),
      days,
    }
  }

  /**
   * Weekly digest, Monday 09:05 club time: pushes each club's last-week numbers to
   * the staff devices. Cheap, constant product presence — and "el bot te vendió N
   * turnos" writes the renewal argument by itself.
   */
  @Cron('5 9 * * 1', { timeZone: process.env.CLUB_TIMEZONE ?? 'America/Argentina/Buenos_Aires' })
  async sendWeeklySummaries(): Promise<void> {
    if (!schedulerEnabled()) return
    try {
      const clubs = await this.prisma.club.findMany({ select: { id: true, name: true } })
      const toKey = shiftDateKey(todayKey(), -1) // Sunday
      const fromKey = shiftDateKey(toKey, -6) // last Monday

      for (const club of clubs) {
        try {
          const summary = await this.weeklySummary(club.id, fromKey, toKey)
          if (summary.bookings === 0) continue // nothing to brag about — don't spam dead clubs
          await this.notifications.notifyClub(club.id, {
            title: `📈 Tu semana en PadelBot`,
            body:
              `${summary.bookings} turnos (${summary.occupancyPct}% de ocupación), ` +
              `$${Math.round(summary.depositCents / 100).toLocaleString('es-AR')} en señas. ` +
              `El bot te vendió ${summary.botBookings} turnos.`,
          })
        } catch (err) {
          this.logger.error(`Weekly summary failed for club ${club.id}`, err)
        }
      }
    } catch (err) {
      this.logger.error('Weekly summaries sweep failed', err)
    }
  }

  private async weeklySummary(clubId: string, fromKey: string, toKey: string) {
    const from = dayRangeUtc(fromKey).gte
    const to = dayRangeUtc(shiftDateKey(toKey, 1)).gte

    const [bookings, botBookings, revenue, occupancy] = await Promise.all([
      this.prisma.booking.count({
        where: { clubId, status: 'CONFIRMED', slot: { startsAt: { gte: from, lt: to } } },
      }),
      this.prisma.booking.count({
        where: { clubId, status: 'CONFIRMED', bookedByUserId: null, slot: { startsAt: { gte: from, lt: to } } },
      }),
      this.getRevenue(clubId, fromKey, toKey),
      this.getOccupancy(clubId, 1),
    ])

    const offered = occupancy.cells.reduce((s, c) => s + c.offered, 0)
    const occupied = occupancy.cells.reduce((s, c) => s + c.occupied, 0)
    return {
      bookings,
      botBookings,
      depositCents: revenue.totalDepositCents,
      occupancyPct: offered > 0 ? Math.round((occupied / offered) * 100) : 0,
    }
  }
}
