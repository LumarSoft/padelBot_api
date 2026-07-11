import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { SubscriptionStatus } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { subscriptionState, SubscriptionState } from '../clubs/lib/subscription'
import { shiftDateKey, todayKey } from '../availability/lib/datetime'
import { UpdateSubscriptionDto } from './dto/update-subscription.dto'

const DAY_MS = 24 * 60 * 60 * 1000
/** Window the per-club activity numbers cover. */
const ACTIVITY_DAYS = 30
/** No panel login in this long = the club has quietly stopped using the product. */
const DORMANT_DAYS = 14

/** One row of the tenants table. Everything here answers "should I worry about this club?". */
export interface OpsClubRow {
  id: string
  name: string
  slug: string
  createdAt: Date
  subscription: SubscriptionState

  /** The three things the bot cannot run without. A club missing any of these is not live. */
  readiness: {
    courts: number
    /** Transfer alias set OR MercadoPago connected — either way the bot can ask for money. */
    paymentsConfigured: boolean
    mpConnected: boolean
    whatsappLines: number
    /** True when all three are in place: this club can take a booking end to end. */
    ready: boolean
    setupCompletedAt: Date | null
  }

  /** Last 30 days. `bot` vs `panel` is the number that proves the product works. */
  activity: {
    bookingsBot: number
    bookingsPanel: number
    /** Deposits actually collected (cents) — our tenants' GMV, and our pricing evidence. */
    depositsCents: number
    conversations: number
    /** Last time ANY staff user opened the panel. Null = never since we started tracking. */
    lastPanelLoginAt: Date | null
    /** No login in DORMANT_DAYS and the club is past its trial → churn risk. */
    dormant: boolean
  }

  /** What this club costs us in OpenAI over the same window (micro-USD). */
  llmCostMicroUsd: number
}

@Injectable()
export class OpsClubsService {
  private readonly logger = new Logger(OpsClubsService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every tenant, with the state we'd otherwise have to open a DB console to see.
   *
   * Deliberately a handful of grouped aggregate queries rather than a per-club loop: at
   * ten clubs either works, but a loop is an N+1 that gets slower exactly as the business
   * gets better.
   */
  async list(): Promise<OpsClubRow[]> {
    const since = new Date(Date.now() - ACTIVITY_DAYS * DAY_MS)
    const sinceKey = shiftDateKey(todayKey(), -(ACTIVITY_DAYS - 1))

    const [clubs, bookings, conversations, logins, llm] = await Promise.all([
      this.prisma.club.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true,
          subscriptionStatus: true,
          plan: true,
          trialEndsAt: true,
          currentPeriodEnd: true,
          setupCompletedAt: true,
          transferAlias: true,
          mpConnectedAt: true,
          _count: { select: { courts: true, whatsappLines: true } },
        },
      }),
      this.prisma.booking.findMany({
        where: { createdAt: { gte: since } },
        select: {
          clubId: true,
          status: true,
          bookedByUserId: true,
          depositCents: true,
        },
      }),
      this.prisma.conversationSession.groupBy({
        by: ['clubId'],
        where: { updatedAt: { gte: since } },
        _count: true,
      }),
      // The most recent login across each club's staff — "did anyone open the panel".
      this.prisma.user.groupBy({
        by: ['clubId'],
        where: { lastLoginAt: { not: null } },
        _max: { lastLoginAt: true },
      }),
      this.prisma.llmUsageDaily.groupBy({
        by: ['clubId'],
        where: { dateKey: { gte: sinceKey } },
        _sum: { costMicroUsd: true },
      }),
    ])

    const conversationsByClub = new Map(conversations.map(c => [c.clubId, c._count]))
    const loginByClub = new Map(logins.map(l => [l.clubId, l._max.lastLoginAt]))
    const llmByClub = new Map(llm.map(l => [l.clubId, l._sum.costMicroUsd ?? 0]))

    const activityByClub = new Map<string, { bot: number; panel: number; deposits: number }>()
    for (const b of bookings) {
      const entry = activityByClub.get(b.clubId) ?? { bot: 0, panel: 0, deposits: 0 }
      // No staff user on the booking = the bot (i.e. a player) created it.
      if (b.bookedByUserId === null) entry.bot++
      else entry.panel++
      if (b.status === 'CONFIRMED') entry.deposits += b.depositCents
      activityByClub.set(b.clubId, entry)
    }

    const dormantBefore = new Date(Date.now() - DORMANT_DAYS * DAY_MS)

    return clubs.map(club => {
      // Only the four subscription fields — `subscriptionState` spreads what it's given,
      // so handing it the whole club row would nest a copy of the club inside its own
      // `subscription` object.
      const subscription = subscriptionState({
        subscriptionStatus: club.subscriptionStatus,
        plan: club.plan,
        trialEndsAt: club.trialEndsAt,
        currentPeriodEnd: club.currentPeriodEnd,
      })
      const activity = activityByClub.get(club.id) ?? { bot: 0, panel: 0, deposits: 0 }
      const lastPanelLoginAt = loginByClub.get(club.id) ?? null

      const paymentsConfigured = Boolean(club.transferAlias) || Boolean(club.mpConnectedAt)
      const ready = club._count.courts > 0 && paymentsConfigured && club._count.whatsappLines > 0

      return {
        id: club.id,
        name: club.name,
        slug: club.slug,
        createdAt: club.createdAt,
        subscription,
        readiness: {
          courts: club._count.courts,
          paymentsConfigured,
          mpConnected: Boolean(club.mpConnectedAt),
          whatsappLines: club._count.whatsappLines,
          ready,
          setupCompletedAt: club.setupCompletedAt,
        },
        activity: {
          bookingsBot: activity.bot,
          bookingsPanel: activity.panel,
          depositsCents: activity.deposits,
          conversations: conversationsByClub.get(club.id) ?? 0,
          lastPanelLoginAt,
          // A club still in trial hasn't had time to go dormant — don't cry wolf on it.
          dormant:
            subscription.subscriptionStatus !== SubscriptionStatus.TRIAL &&
            (lastPanelLoginAt === null || lastPanelLoginAt < dormantBefore),
        },
        llmCostMicroUsd: llmByClub.get(club.id) ?? 0,
      }
    })
  }

  /**
   * Manual billing, from the console instead of the shell. Same semantics as
   * `scripts/set-subscription.ts`: ACTIVE extends the paid period, TRIAL extends the trial.
   */
  async updateSubscription(clubId: string, dto: UpdateSubscriptionDto): Promise<SubscriptionState> {
    const club = await this.prisma.club.findUnique({ where: { id: clubId }, select: { id: true, name: true } })
    if (!club) throw new NotFoundException('Club no encontrado')

    const data: {
      subscriptionStatus: SubscriptionStatus
      plan?: string
      currentPeriodEnd?: Date
      trialEndsAt?: Date
    } = { subscriptionStatus: dto.status }

    if (dto.plan) data.plan = dto.plan
    if (dto.status === SubscriptionStatus.ACTIVE) {
      data.currentPeriodEnd = new Date(Date.now() + (dto.months ?? 1) * 30 * DAY_MS)
    }
    if (dto.status === SubscriptionStatus.TRIAL) {
      data.trialEndsAt = new Date(Date.now() + (dto.days ?? 14) * DAY_MS)
    }

    const updated = await this.prisma.club.update({
      where: { id: clubId },
      data,
      select: {
        subscriptionStatus: true,
        plan: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
      },
    })

    this.logger.log(`Subscription of ${club.name} (${clubId}) set to ${dto.status}`)
    return subscriptionState(updated)
  }
}
