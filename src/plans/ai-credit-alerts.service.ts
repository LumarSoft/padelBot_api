import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { todayKey } from '../availability/lib/datetime'
import { notifyOps } from '../common/ops-alert'
import { schedulerEnabled } from '../common/scheduling'
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
 * Tells ops when a club nears or passes its monthly AI credits (80% / 100%), once per threshold
 * and month. Credits are the messages the bot sends; going over is never enforced — the bot keeps
 * answering — so this alert is the cue to follow up with a bigger plan.
 */
@Injectable()
export class AiCreditAlertsService {
  private readonly logger = new Logger(AiCreditAlertsService.name)

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async checkUsage(): Promise<void> {
    if (!schedulerEnabled()) return
    try {
      await this.alertCrossedThresholds()
    } catch (err) {
      this.logger.error('AI credit check failed', err)
    }
  }

  /** One grouped query for the month's usage, then one alert (and one update) per crossing. */
  async alertCrossedThresholds(today: string = todayKey()): Promise<void> {
    const month = monthKeyOf(today)
    const usage = await this.prisma.whatsAppMessageDaily.groupBy({
      by: ['clubId'],
      where: { dateKey: { gte: monthStartKey(today), lte: today } },
      _sum: { botService: true, utility: true },
    })
    if (usage.length === 0) return

    const clubs = await this.prisma.club.findMany({
      // The sales demo's usage is simulated: alerting on it would only teach us to ignore alerts.
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
      await this.prisma.club.update({
        where: { id: club.id },
        data: { aiCreditsAlertMonth: month, aiCreditsAlertPercent: crossed },
      })
    }
  }
}

const count = (n: number) => n.toLocaleString('es-AR')

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
  return crossed === 100
    ? `🔴 *${clubName}* superó sus créditos: ${usage}. El bot sigue atendiendo igual.${offer}`
    : `🟡 *${clubName}* ya usó el ${creditPercent(used, plan.aiCredits)}%: ${usage}.${offer}`
}
