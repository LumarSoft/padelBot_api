import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { dayRangeUtc, shiftDateKey, todayKey, toDateKey } from '../availability/lib/datetime'

/** How many days of history the overview chart covers (including today). */
const SERIES_DAYS = 14
/** A conversation counts as "active" if it had a message within this window. */
const ACTIVE_CHAT_WINDOW_MS = 24 * 60 * 60 * 1000

export interface OverviewStats {
  /** Confirmed bookings whose slot is today (club-local calendar day). */
  turnosHoy: number
  /** Confirmed bookings whose slot is still in the future. */
  reservasActivas: number
  /** Conversations with activity in the last 24h. */
  chatsActivos: number
  /** Pending-payment bookings whose link hasn't expired. */
  pendientesPago: number
  /** Deposits collected from confirmed bookings in the window (cents). */
  ingresosCents: number
  /** Confirmed bookings the bot/player created (no staff user) in the window. */
  reservasBot: number
  /** Confirmed bookings staff created from the panel in the window. */
  reservasPanel: number
  /** Per-day count of non-cancelled bookings created over the last SERIES_DAYS. */
  series: { date: string; count: number }[]
}

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(clubId: string): Promise<OverviewStats> {
    const now = new Date()
    const today = todayKey()
    const todayRange = dayRangeUtc(today)
    const startKey = shiftDateKey(today, -(SERIES_DAYS - 1))
    const windowStart = dayRangeUtc(startKey).gte

    const [
      turnosHoy,
      reservasActivas,
      chatsActivos,
      pendientesPago,
      ingresos,
      reservasBot,
      reservasPanel,
      createdInWindow,
    ] = await Promise.all([
      this.prisma.booking.count({
        where: { clubId, status: 'CONFIRMED', slot: { startsAt: { gte: todayRange.gte, lt: todayRange.lt } } },
      }),
      this.prisma.booking.count({
        where: { clubId, status: 'CONFIRMED', slot: { startsAt: { gte: now } } },
      }),
      this.prisma.conversationSession.count({
        where: { clubId, updatedAt: { gte: new Date(now.getTime() - ACTIVE_CHAT_WINDOW_MS) } },
      }),
      this.prisma.booking.count({
        where: { clubId, status: 'PENDING_PAYMENT', paymentExpiresAt: { gt: now } },
      }),
      this.prisma.booking.aggregate({
        _sum: { depositCents: true },
        where: { clubId, status: 'CONFIRMED', createdAt: { gte: windowStart } },
      }),
      this.prisma.booking.count({
        where: { clubId, status: 'CONFIRMED', bookedByUserId: null, createdAt: { gte: windowStart } },
      }),
      this.prisma.booking.count({
        where: { clubId, status: 'CONFIRMED', bookedByUserId: { not: null }, createdAt: { gte: windowStart } },
      }),
      this.prisma.booking.findMany({
        where: { clubId, status: { not: 'CANCELLED' }, createdAt: { gte: windowStart } },
        select: { createdAt: true },
      }),
    ])

    return {
      turnosHoy,
      reservasActivas,
      chatsActivos,
      pendientesPago,
      ingresosCents: ingresos._sum.depositCents ?? 0,
      reservasBot,
      reservasPanel,
      series: this.buildSeries(
        startKey,
        createdInWindow.map(b => b.createdAt),
      ),
    }
  }

  /** Buckets booking creation instants into per-day counts over the series window. */
  private buildSeries(startKey: string, createdAt: Date[]): { date: string; count: number }[] {
    const counts = new Map<string, number>()
    for (let i = 0; i < SERIES_DAYS; i++) {
      counts.set(shiftDateKey(startKey, i), 0)
    }
    for (const instant of createdAt) {
      const key = toDateKey(instant)
      if (counts.has(key)) counts.set(key, counts.get(key)! + 1)
    }
    return Array.from(counts, ([date, count]) => ({ date, count }))
  }
}
