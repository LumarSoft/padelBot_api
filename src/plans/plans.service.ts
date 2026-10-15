import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { todayKey } from '../availability/lib/datetime'
import { CreditsService } from './credits.service'
import { creditPercent, CreditsNoticeLevel, creditsNoticeKey, creditsNoticeLevel, monthKeyOf } from './lib/ai-credits'
import { featureLockedMessage } from './lib/features'
import { courtLimitMessage, userLimitMessage } from './lib/limits'
import {
  cheapestPlanWith,
  fitsOneMore,
  hasFeature,
  PLAN_FEATURES,
  PlanFeature,
  PlanFields,
  planDefinition,
  planFieldsSelect,
  planName,
} from './lib/plans'

/** Something counted against a plan limit. */
export interface PlanUsage {
  used: number
  /** null = the plan has no limit (or the plan key is unknown). */
  limit: number | null
}

/** What the panel shows about the club's plan: what it includes and how much of it is used. */
export interface ClubPlanOverview {
  plan: {
    key: string
    name: string
    /** False when the stored key is none of the three plans: nothing is restricted then. */
    known: boolean
  }
  courts: PlanUsage
  /** Active users, the owner included. */
  users: PlanUsage
  /**
   * Credits of the current calendar month: one per WhatsApp message the bot sends. `limit` is
   * the plan's; `available` adds the credit packs (spent this month + still left). Going over
   * never cuts the bot.
   */
  aiCredits: PlanUsage & {
    /** "2026-10": the month being counted (club-local). */
    month: string
    /** Whole percentage of the plan's credits used (can pass 100); null without an allowance. */
    percent: number | null
    /** Of `used`, the ones paid from credit packs. */
    fromPacks: number
    /** Pack credits still left (not expired). */
    extraBalance: number
    /** Plan credits + pack credits spent this month + pack credits left: the bar's total. */
    available: number | null
  }
  /** Each module: whether the club may use it, and the cheapest plan that includes it. */
  features: Record<PlanFeature, { enabled: boolean; plan: string }>
  /** The club predates the plans and keeps every module, whatever its plan says. */
  grandfatheredFeatures: boolean
  /**
   * The owner's "te quedan pocos créditos" banner: 80% / 100% of plan + pack credits, and
   * whether THIS user closed it (it stays closed that month; it returns once at 100%).
   */
  creditsNotice: { level: CreditsNoticeLevel | null; dismissed: boolean }
}

/**
 * What a club's plan lets it do. Shared by every module that creates something a plan limits,
 * so the refusal and its wording live in one place.
 */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credits: CreditsService,
  ) {}

  async overview(clubId: string, userId?: number): Promise<ClubPlanOverview> {
    const today = todayKey()
    const [club, courts, users, month, packs, viewer] = await Promise.all([
      this.clubPlan(clubId),
      this.countCourts(clubId),
      this.countActiveUsers(clubId),
      this.credits.monthCredits(clubId, today),
      this.credits.activePacks(clubId),
      userId
        ? this.prisma.user.findFirst({ where: { id: userId, clubId }, select: { creditsNoticeDismissed: true } })
        : null,
    ])
    const extraBalance = packs.reduce((sum, pack) => sum + pack.remaining, 0)
    const plan = planDefinition(club.plan)
    const allowance = plan?.aiCredits ?? null
    const available = allowance === null ? null : allowance + month.fromPacks + extraBalance
    const noticeLevel = creditsNoticeLevel(month.used, available)
    const features = Object.fromEntries(
      PLAN_FEATURES.map(feature => [
        feature,
        { enabled: hasFeature(club, feature), plan: cheapestPlanWith(feature).name },
      ]),
    ) as ClubPlanOverview['features']
    return {
      plan: { key: club.plan, name: planName(club.plan), known: plan !== null },
      courts: { used: courts, limit: plan?.courts ?? null },
      users: { used: users, limit: plan?.users ?? null },
      aiCredits: {
        used: month.used,
        limit: allowance,
        month: monthKeyOf(today),
        percent: creditPercent(month.used, allowance),
        fromPacks: month.fromPacks,
        extraBalance,
        available,
      },
      features,
      grandfatheredFeatures: club.grandfatheredFeatures,
      creditsNotice: {
        level: noticeLevel,
        dismissed:
          noticeLevel !== null && viewer?.creditsNoticeDismissed === creditsNoticeKey(monthKeyOf(today), noticeLevel),
      },
    }
  }

  /** Closes the credits notice for this user, at the level it's showing now, until next month. */
  async dismissCreditsNotice(clubId: string, userId: number): Promise<void> {
    const { creditsNotice, aiCredits } = await this.overview(clubId)
    if (creditsNotice.level === null) return
    await this.prisma.user.updateMany({
      where: { id: userId, clubId },
      data: { creditsNoticeDismissed: creditsNoticeKey(aiCredits.month, creditsNotice.level) },
    })
  }

  /** Whether the club's plan includes a module (always, for a club that predates the plans). */
  async hasFeature(clubId: string, feature: PlanFeature): Promise<boolean> {
    return hasFeature(await this.clubPlan(clubId), feature)
  }

  /**
   * Refuses turning ON a module the plan doesn't include. Callers ask only when something is
   * being switched on — never for what the club already has running, which keeps working.
   */
  async assertFeature(clubId: string, feature: PlanFeature): Promise<void> {
    if (!(await this.hasFeature(clubId, feature))) throw new ForbiddenException(featureLockedMessage(feature))
  }

  /**
   * Refuses a court beyond the plan's limit. A soft limit: courts the club already has are
   * never touched, and two simultaneous creations may both pass — one court over is not worth
   * a lock.
   */
  async assertCanAddCourt(clubId: string): Promise<void> {
    const [club, courts] = await Promise.all([this.clubPlan(clubId), this.countCourts(clubId)])
    const plan = planDefinition(club.plan)
    if (!plan || fitsOneMore(courts, plan.courts)) return
    throw new ForbiddenException(courtLimitMessage(plan, courts))
  }

  /** Refuses one more ACTIVE user (a new one, or reactivating one) beyond the plan's limit. */
  async assertCanAddUser(clubId: string): Promise<void> {
    const [club, users] = await Promise.all([this.clubPlan(clubId), this.countActiveUsers(clubId)])
    const plan = planDefinition(club.plan)
    if (!plan || fitsOneMore(users, plan.users)) return
    throw new ForbiddenException(userLimitMessage(plan, users))
  }

  private async clubPlan(clubId: string): Promise<PlanFields> {
    const club = await this.prisma.club.findUnique({ where: { id: clubId }, select: planFieldsSelect })
    if (!club) throw new NotFoundException('Club no encontrado')
    return club
  }

  private countCourts(clubId: string): Promise<number> {
    return this.prisma.court.count({ where: { clubId } })
  }

  private countActiveUsers(clubId: string): Promise<number> {
    return this.prisma.user.count({ where: { clubId, isActive: true } })
  }
}
