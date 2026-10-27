import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { SubscriptionStatus } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { schedulerEnabled } from '../common/scheduling'
import { todayKey, toDateKey } from '../availability/lib/datetime'
import { monthKeyOf } from '../plans/lib/ai-credits'
import { SALES_DEMO_SLUG } from '../demo/sales-demo.seed'
import { planPriceCents } from './lib/pricing'

/** One month of the business: recurring revenue, new clubs, clubs that started paying, churn. */
export interface MonthBusiness {
  /** "2026-10". */
  month: string
  /** Clubs created that month (the sales demo aside). Known for every month. */
  newClubs: number
  /** Whether any subscription was recorded that month; before that the rest is unknown (null). */
  tracked: boolean
  /** Monthly recurring revenue at the month's close (or today, for the current one). */
  mrrCents: number | null
  /** Clubs paying (ACTIVE) at the month's close. */
  paying: number | null
  /** Paying this month, not the month before. Null without a tracked month before. */
  newPaying: number | null
  /** Paying the month before, not this month (lapsed, cancelled or deleted). */
  churned: number | null
  churnedClubs: string[]
}

/** Club-local months, newest last: "2026-10" and the `count - 1` before it. */
export function lastMonths(current: string, count: number): string[] {
  const [year, month] = current.split('-').map(Number)
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(Date.UTC(year, month - 1 - (count - 1 - i), 1))
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
  })
}

interface StateRow {
  clubId: string
  month: string
  clubName: string
  subscriptionStatus: SubscriptionStatus
  mrrCents: number
}

/** Builds the monthly business series from the recorded states and the clubs' creation dates. */
export function monthlyBusiness(months: string[], states: StateRow[], createdMonths: string[]): MonthBusiness[] {
  const byMonth = new Map<string, Map<string, StateRow>>()
  for (const row of states) {
    const month = byMonth.get(row.month) ?? new Map<string, StateRow>()
    month.set(row.clubId, row)
    byMonth.set(row.month, month)
  }
  const paying = (rows: Map<string, StateRow> | undefined) =>
    new Map(
      [...(rows ?? new Map<string, StateRow>()).entries()].filter(([, row]) => row.subscriptionStatus === 'ACTIVE'),
    )

  return months.map(month => {
    const newClubs = createdMonths.filter(m => m === month).length
    const rows = byMonth.get(month)
    if (!rows) {
      return {
        month,
        newClubs,
        tracked: false,
        mrrCents: null,
        paying: null,
        newPaying: null,
        churned: null,
        churnedClubs: [],
      }
    }
    const now = paying(rows)
    const previous = byMonth.get(previousMonth(month))
    const before = previous ? paying(previous) : null
    const churned = before ? [...before.values()].filter(row => !now.has(row.clubId)) : null
    return {
      month,
      newClubs,
      tracked: true,
      mrrCents: [...now.values()].reduce((sum, row) => sum + row.mrrCents, 0),
      paying: now.size,
      newPaying: before ? [...now.keys()].filter(id => !before.has(id)).length : null,
      churned: churned ? churned.length : null,
      churnedClubs: churned ? churned.map(row => row.clubName) : [],
    }
  })
}

function previousMonth(month: string): string {
  return lastMonths(month, 2)[0]
}

/**
 * Records each club's subscription per month (`ClubMonthState`): every day, on boot and after
 * every change from the console, so a month keeps the last state it saw. That is what lets the
 * business screen draw recurring revenue, new paying clubs and churn month by month even though
 * billing is manual and the club row only knows today.
 */
@Injectable()
export class OpsMonthStatesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OpsMonthStatesService.name)

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    if (!schedulerEnabled()) return
    void this.recordAll().catch(err => this.logger.error('Could not record the month states on boot', err))
  }

  @Cron('50 23 * * *', { timeZone: process.env.CLUB_TIMEZONE ?? 'America/Argentina/Buenos_Aires' })
  async recordDaily(): Promise<void> {
    if (!schedulerEnabled()) return
    try {
      await this.recordAll()
    } catch (err) {
      this.logger.error('Could not record the month states', err)
    }
  }

  /** Every club's state, as this month's. */
  async recordAll(): Promise<void> {
    const clubs = await this.prisma.club.findMany({ select: { id: true } })
    for (const club of clubs) await this.recordClub(club.id)
  }

  /** One club's state, as this month's (after a change from the console). */
  async recordClub(clubId: string): Promise<void> {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { name: true, slug: true, plan: true, subscriptionStatus: true },
    })
    if (!club) return
    const month = monthKeyOf(todayKey())
    const data = {
      clubName: club.name,
      plan: club.plan,
      subscriptionStatus: club.subscriptionStatus,
      mrrCents: club.subscriptionStatus === SubscriptionStatus.ACTIVE ? planPriceCents(club.plan) : 0,
      isDemo: club.slug === SALES_DEMO_SLUG,
    }
    await this.prisma.clubMonthState.upsert({
      where: { clubId_month: { clubId, month } },
      create: { clubId, month, ...data },
      update: data,
    })
  }

  /** The last `count` months of the business, oldest first (the sales demo left out). */
  async monthly(count = 12): Promise<MonthBusiness[]> {
    const months = lastMonths(monthKeyOf(todayKey()), count)
    const [states, clubs] = await Promise.all([
      this.prisma.clubMonthState.findMany({
        // One month more, so the first one shown can tell who started paying and who left.
        where: { month: { in: [previousMonth(months[0]), ...months] }, isDemo: false },
        select: { clubId: true, month: true, clubName: true, subscriptionStatus: true, mrrCents: true },
      }),
      this.prisma.club.findMany({ where: { slug: { not: SALES_DEMO_SLUG } }, select: { createdAt: true } }),
    ])
    return monthlyBusiness(
      months,
      states,
      clubs.map(club => monthKeyOf(toDateKey(club.createdAt))),
    )
  }
}
