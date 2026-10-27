import { Injectable, NotFoundException } from '@nestjs/common'
import { SubscriptionStatus } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { todayKey } from '../availability/lib/datetime'
import { subscriptionSelect, subscriptionState } from '../clubs/lib/subscription'
import { CreditsService } from '../plans/credits.service'
import { creditPercent, monthKeyOf } from '../plans/lib/ai-credits'
import { planDefinition, planName } from '../plans/lib/plans'

/** Everything the owner's "Facturación" page shows. */
export interface BillingOverview {
  plan: { key: string; name: string; known: boolean }
  subscription: {
    status: SubscriptionStatus
    severity: 'ok' | 'trial' | 'warning' | 'blocked'
    /** End of the paid period (or of the trial); null when there's no date. */
    renewsAt: Date | null
  }
  credits: {
    month: string
    used: number
    /** The plan's credits for the month; null for an unknown plan. */
    included: number | null
    percent: number | null
    /** Used up: the bot is paused until a bigger plan or the next month. */
    paused: boolean
  }
}

/** The owner's view of what the club has with Lumarsoft: its plan, subscription and credits. */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credits: CreditsService,
  ) {}

  async overview(clubId: string): Promise<BillingOverview> {
    const today = todayKey()
    const [club, { used, paused }] = await Promise.all([
      this.prisma.club.findUnique({ where: { id: clubId }, select: subscriptionSelect }),
      this.credits.monthState(clubId, today),
    ])
    if (!club) throw new NotFoundException('Club no encontrado')

    const plan = planDefinition(club.plan)
    const included = plan?.aiCredits ?? null
    return {
      plan: { key: club.plan, name: planName(club.plan), known: plan !== null },
      subscription: {
        status: club.subscriptionStatus,
        severity: subscriptionState(club).severity,
        renewsAt:
          club.subscriptionStatus === SubscriptionStatus.TRIAL
            ? club.trialEndsAt
            : club.subscriptionStatus === SubscriptionStatus.CANCELLED
              ? null
              : club.currentPeriodEnd,
      },
      credits: { month: monthKeyOf(today), used, included, percent: creditPercent(used, included), paused },
    }
  }
}
