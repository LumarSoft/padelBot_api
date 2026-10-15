import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { todayKey } from '../availability/lib/datetime'
import { notifyOps } from '../common/ops-alert'
import { schedulerEnabled } from '../common/scheduling'
import { NotificationsService, PushPayload } from '../notifications/notifications.service'
import { SALES_DEMO_SLUG } from '../demo/sales-demo.seed'
import {
  AiCreditAlertPercent,
  creditPercent,
  crossedAlertPercent,
  monthKeyOf,
  monthName,
  monthStartKey,
} from './lib/ai-credits'
import { nextPlanWithRoom, planDefinition, PlanDefinition } from './lib/plans'

/**
 * Warns ops AND the club as a club's monthly credits run down: 20%, 10% and 5% left, and when
 * they run out — the moment the bot pauses. Once per threshold and month (`Club.aiCreditsAlert*`).
 * Ops gets the plan to offer; the club gets a push (the owners while warning, everyone once the
 * bot is paused, since the staff now answers by hand). Every 5 minutes, so the pause is announced
 * close to when it happens.
 */
@Injectable()
export class AiCreditAlertsService {
  private readonly logger = new Logger(AiCreditAlertsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkUsage(): Promise<void> {
    if (!schedulerEnabled()) return
    try {
      await this.alertCrossedThresholds()
    } catch (err) {
      this.logger.error('AI credit check failed', err)
    }
  }

  /** One grouped query for the month's usage, then the alerts (and one update) per crossing. */
  async alertCrossedThresholds(today: string = todayKey()): Promise<void> {
    const month = monthKeyOf(today)
    const usage = await this.prisma.whatsAppMessageDaily.groupBy({
      by: ['clubId'],
      where: { dateKey: { gte: monthStartKey(today), lte: today } },
      _sum: { botService: true, utility: true },
    })
    if (usage.length === 0) return

    const clubs = await this.prisma.club.findMany({
      // The sales demo's usage is simulated (and its bot never pauses): no alerts for it.
      where: { id: { in: usage.map(u => u.clubId) }, slug: { not: SALES_DEMO_SLUG } },
      select: { id: true, name: true, plan: true, aiCreditsAlertMonth: true, aiCreditsAlertPercent: true },
    })
    const usedByClub = new Map(usage.map(u => [u.clubId, (u._sum.botService ?? 0) + (u._sum.utility ?? 0)]))

    for (const club of clubs) {
      const plan = planDefinition(club.plan)
      if (!plan) continue
      const used = usedByClub.get(club.id) ?? 0
      const crossed = crossedAlertPercent(used, plan.aiCredits)
      if (crossed === null) continue
      const alreadySent = club.aiCreditsAlertMonth === month ? (club.aiCreditsAlertPercent ?? 0) : 0
      if (crossed <= alreadySent) continue

      await notifyOps(aiCreditAlert(club.name, plan, used, crossed, month))
      const push = clubCreditsPush(plan, used, crossed, month)
      // Paused, the staff has to answer the players by hand: everyone hears it.
      if (crossed === 100) await this.notifications.notifyClub(club.id, push)
      else await this.notifications.notifyOwners(club.id, push)
      await this.prisma.club.update({
        where: { id: club.id },
        data: { aiCreditsAlertMonth: month, aiCreditsAlertPercent: crossed },
      })
    }
  }
}

const count = (n: number) => n.toLocaleString('es-AR')

/** Whole percentage of the plan's credits still left (the threshold names the trigger, not this). */
const leftPercent = (used: number, plan: PlanDefinition) =>
  Math.max(0, 100 - (creditPercent(used, plan.aiCredits) ?? 0))

/** The month after "2026-10", named: when the plan's credits come back on their own. */
function nextMonthName(month: string): string {
  const [year, m] = month.split('-').map(Number)
  return monthName(m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`)
}

/** The ops message: who, how much of what, and the plan to offer. */
export function aiCreditAlert(
  clubName: string,
  plan: PlanDefinition,
  used: number,
  crossed: AiCreditAlertPercent,
  month: string,
): string {
  // A plan with more credits than both this one and what the club already uses.
  const next = nextPlanWithRoom(p => p.aiCredits, Math.max(used, plan.aiCredits))
  const offer = next ? ` Ofrecele pasar a ${next.name}.` : ' Ningún plan le alcanza: hablalo con el club.'
  const usage = `${count(used)} de ${count(plan.aiCredits)} créditos de ${monthName(month)} (plan ${plan.name})`
  if (crossed === 100) {
    return (
      `🔴 *${clubName}* se quedó sin créditos: ${usage}. El bot está pausado hasta que cambie de plan ` +
      `(o hasta el 1° de ${nextMonthName(month)}).${offer}`
    )
  }
  const icon = crossed === 80 ? '🟡' : '🟠'
  return `${icon} A *${clubName}* le queda el ${leftPercent(used, plan)}% de sus créditos: ${usage}.${offer}`
}

/** The club's push: how much is left, or that the bot is paused and what to do about it. */
export function clubCreditsPush(
  plan: PlanDefinition,
  used: number,
  crossed: AiCreditAlertPercent,
  month: string,
): PushPayload {
  const data = { type: 'credits' }
  if (crossed === 100) {
    return {
      title: '⏸️ El bot está pausado',
      body:
        `Se terminaron los créditos de IA de ${monthName(month)}. Cambiá de plan para que vuelva a ` +
        'atender; mientras tanto, respondé a los jugadores desde Conversaciones.',
      data,
    }
  }
  return {
    title: `Te queda el ${leftPercent(used, plan)}% de tus créditos de IA`,
    body:
      `Usaste ${count(used)} de ${count(plan.aiCredits)} en ${monthName(month)}. Si se terminan, ` +
      'el bot se pausa hasta que cambies de plan.',
    data,
  }
}
