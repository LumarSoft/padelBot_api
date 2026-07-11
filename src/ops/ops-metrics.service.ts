import { Injectable } from '@nestjs/common'
import { SubscriptionStatus } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { shiftDateKey, todayKey, toDateKey } from '../availability/lib/datetime'
import { planPriceCents } from './lib/pricing'

const DAY_MS = 24 * 60 * 60 * 1000
/** Window every "last N days" number on the business screen covers. */
const WINDOW_DAYS = 30
/** A club is "activated" when it takes its first real bot booking within this many days. */
const ACTIVATION_DAYS = 7

export interface BusinessMetrics {
  /** Monthly recurring revenue (cents) from ACTIVE clubs, priced by plan (see lib/pricing). */
  mrrCents: number
  /** Clubs whose plan has no configured price — they're invisible in the MRR until we set it. */
  clubsWithoutPrice: number
  clubs: {
    total: number
    trial: number
    active: number
    pastDue: number
    cancelled: number
    /** Clubs that CAN take a booking end to end (courts + payments + WhatsApp). */
    ready: number
  }
  /**
   * Activation: of the clubs we provisioned, how many reached a real bot booking within
   * ACTIVATION_DAYS. This is the honest measure of whether onboarding works — a club that
   * never gets here will never renew.
   */
  activation: {
    provisioned: number
    activated: number
    /** Median days from club creation to its first confirmed bot booking. */
    medianDaysToFirstBooking: number | null
  }
  /** Our tenants' money, last WINDOW_DAYS: deposits actually reconciled. */
  gmvCents: number
  bookings: {
    bot: number
    panel: number
  }
  /** Daily series (last WINDOW_DAYS) of bookings created, split by origin. */
  series: { date: string; bot: number; panel: number }[]
}

export interface BotMetrics {
  /**
   * The funnel that says whether the bot is doing its job: of the conversations we had,
   * how many ended in a confirmed booking, and how many we had to hand to a human.
   */
  funnel: {
    conversations: number
    bookingsStarted: number
    bookingsConfirmed: number
    handedToHuman: number
  }
  /** Sessions sitting in each state — where players abandon the flow. */
  byState: { state: string; count: number }[]
  messages: { user: number; bot: number; admin: number }
  cost: {
    /** Micro-USD over the window. Integers all the way; formatted at the edge. */
    totalMicroUsd: number
    calls: number
    /** What one confirmed bot booking costs us in OpenAI. The unit economics in one number. */
    microUsdPerConfirmedBooking: number | null
    perClub: { clubId: string; clubName: string; microUsd: number; calls: number }[]
    series: { date: string; microUsd: number }[]
  }
}

@Injectable()
export class OpsMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async getBusiness(): Promise<BusinessMetrics> {
    const since = new Date(Date.now() - WINDOW_DAYS * DAY_MS)

    const [clubs, bookings, firstBotBookings] = await Promise.all([
      this.prisma.club.findMany({
        select: {
          id: true,
          plan: true,
          subscriptionStatus: true,
          createdAt: true,
          transferAlias: true,
          mpConnectedAt: true,
          _count: { select: { courts: true, whatsappLines: true } },
        },
      }),
      this.prisma.booking.findMany({
        where: { createdAt: { gte: since } },
        select: { status: true, bookedByUserId: true, depositCents: true, createdAt: true },
      }),
      // First CONFIRMED booking the bot ever took, per club — the activation moment.
      this.prisma.booking.groupBy({
        by: ['clubId'],
        where: { status: 'CONFIRMED', bookedByUserId: null },
        _min: { createdAt: true },
      }),
    ])

    let mrrCents = 0
    let clubsWithoutPrice = 0
    const counts = { total: clubs.length, trial: 0, active: 0, pastDue: 0, cancelled: 0, ready: 0 }

    for (const club of clubs) {
      switch (club.subscriptionStatus) {
        case SubscriptionStatus.TRIAL:
          counts.trial++
          break
        case SubscriptionStatus.ACTIVE: {
          counts.active++
          const price = planPriceCents(club.plan)
          if (price === 0) clubsWithoutPrice++
          mrrCents += price
          break
        }
        case SubscriptionStatus.PAST_DUE:
          counts.pastDue++
          break
        case SubscriptionStatus.CANCELLED:
          counts.cancelled++
          break
      }

      const paymentsConfigured = Boolean(club.transferAlias) || Boolean(club.mpConnectedAt)
      if (club._count.courts > 0 && paymentsConfigured && club._count.whatsappLines > 0) counts.ready++
    }

    // ── Activation ────────────────────────────────────────────────────────────
    const firstBookingByClub = new Map(firstBotBookings.map(b => [b.clubId, b._min.createdAt]))
    const daysToFirst: number[] = []
    let activated = 0
    for (const club of clubs) {
      const first = firstBookingByClub.get(club.id)
      if (!first) continue
      const days = (first.getTime() - club.createdAt.getTime()) / DAY_MS
      daysToFirst.push(days)
      if (days <= ACTIVATION_DAYS) activated++
    }
    daysToFirst.sort((a, b) => a - b)
    const medianDaysToFirstBooking = daysToFirst.length
      ? Math.round(daysToFirst[Math.floor(daysToFirst.length / 2)] * 10) / 10
      : null

    // ── Volume ────────────────────────────────────────────────────────────────
    let gmvCents = 0
    const volume = { bot: 0, panel: 0 }
    const seriesMap = new Map<string, { bot: number; panel: number }>()
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
      seriesMap.set(shiftDateKey(todayKey(), -i), { bot: 0, panel: 0 })
    }

    for (const b of bookings) {
      const isBot = b.bookedByUserId === null
      if (isBot) volume.bot++
      else volume.panel++
      if (b.status === 'CONFIRMED') gmvCents += b.depositCents

      const day = seriesMap.get(toDateKey(b.createdAt))
      if (day) {
        if (isBot) day.bot++
        else day.panel++
      }
    }

    return {
      mrrCents,
      clubsWithoutPrice,
      clubs: counts,
      activation: {
        provisioned: clubs.length,
        activated,
        medianDaysToFirstBooking,
      },
      gmvCents,
      bookings: volume,
      series: [...seriesMap.entries()].map(([date, v]) => ({ date, ...v })),
    }
  }

  async getBot(): Promise<BotMetrics> {
    const since = new Date(Date.now() - WINDOW_DAYS * DAY_MS)
    const sinceKey = shiftDateKey(todayKey(), -(WINDOW_DAYS - 1))

    const [conversations, byState, handedToHuman, messages, bookings, llmRows, clubs] = await Promise.all([
      this.prisma.conversationSession.count({ where: { updatedAt: { gte: since } } }),
      this.prisma.conversationSession.groupBy({ by: ['state'], _count: true }),
      this.prisma.conversationSession.count({
        where: { OR: [{ needsAdvisor: true }, { mode: 'HUMAN' }], updatedAt: { gte: since } },
      }),
      this.prisma.conversationMessage.groupBy({
        by: ['role'],
        where: { createdAt: { gte: since } },
        _count: true,
      }),
      this.prisma.booking.groupBy({
        by: ['status'],
        where: { createdAt: { gte: since }, bookedByUserId: null },
        _count: true,
      }),
      this.prisma.llmUsageDaily.findMany({
        where: { dateKey: { gte: sinceKey } },
        select: { clubId: true, dateKey: true, calls: true, costMicroUsd: true },
      }),
      this.prisma.club.findMany({ select: { id: true, name: true } }),
    ])

    const messageCounts = { user: 0, bot: 0, admin: 0 }
    for (const m of messages) {
      const key = m.role.toLowerCase() as keyof typeof messageCounts
      if (key in messageCounts) messageCounts[key] = m._count
    }

    // A bot booking in ANY state was a booking the bot started; CONFIRMED is one it finished.
    const bookingsStarted = bookings.reduce((sum, b) => sum + b._count, 0)
    const bookingsConfirmed = bookings.find(b => b.status === 'CONFIRMED')?._count ?? 0

    // ── Cost ──────────────────────────────────────────────────────────────────
    const clubNames = new Map(clubs.map(c => [c.id, c.name]))
    const perClub = new Map<string, { microUsd: number; calls: number }>()
    const costSeries = new Map<string, number>()
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) costSeries.set(shiftDateKey(todayKey(), -i), 0)

    let totalMicroUsd = 0
    let calls = 0
    for (const row of llmRows) {
      totalMicroUsd += row.costMicroUsd
      calls += row.calls

      const entry = perClub.get(row.clubId) ?? { microUsd: 0, calls: 0 }
      entry.microUsd += row.costMicroUsd
      entry.calls += row.calls
      perClub.set(row.clubId, entry)

      if (costSeries.has(row.dateKey)) {
        costSeries.set(row.dateKey, costSeries.get(row.dateKey)! + row.costMicroUsd)
      }
    }

    return {
      funnel: { conversations, bookingsStarted, bookingsConfirmed, handedToHuman },
      byState: byState.map(s => ({ state: s.state, count: s._count })).sort((a, b) => b.count - a.count),
      messages: messageCounts,
      cost: {
        totalMicroUsd,
        calls,
        microUsdPerConfirmedBooking: bookingsConfirmed ? Math.round(totalMicroUsd / bookingsConfirmed) : null,
        perClub: [...perClub.entries()]
          .map(([clubId, v]) => ({ clubId, clubName: clubNames.get(clubId) ?? clubId, ...v }))
          .sort((a, b) => b.microUsd - a.microUsd),
        series: [...costSeries.entries()].map(([date, microUsd]) => ({ date, microUsd })),
      },
    }
  }
}
