import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { paymentSetupSelect, paymentsConfigured } from '../clubs/lib/payment-policy'
import { todayKey } from '../availability/lib/datetime'
import { creditsPaused, monthStartKey } from '../plans/lib/ai-credits'
import { nextPlanWithRoom, planDefinition } from '../plans/lib/plans'
import { SALES_DEMO_SLUG } from '../demo/sales-demo.seed'
import { PaymentsService, PollerHealth } from '../payments/payments.service'

const DAY_MS = 24 * 60 * 60 * 1000
/** A pending payment still sitting unresolved this long past its expiry is stuck, not pending. */
const STUCK_GRACE_MS = 30 * 60 * 1000
/** Warn this far ahead of a club's MercadoPago token expiring. */
const TOKEN_WARNING_MS = 3 * DAY_MS

/**
 * One thing that needs a human. Everything on the health screen is an ISSUE — if the list
 * is empty, the system is fine and there is nothing to read. A dashboard of green ticks
 * trains you to ignore it; a list that is usually empty gets looked at.
 */
export interface HealthIssue {
  /** Machine-readable kind, so the UI can group/route without parsing prose. */
  kind:
    | 'POLLER_DOWN'
    | 'CLUB_MP_FAILING'
    | 'STUCK_PENDING'
    | 'RECEIPT_AWAITING_REVIEW'
    | 'MP_TOKEN_EXPIRING'
    | 'ADVISOR_WAITING'
    | 'CLUB_NOT_LIVE'
    | 'BOT_PAUSED_NO_CREDITS'
  severity: 'critical' | 'warning'
  /** Written for a human on call, in Spanish, saying what broke and for whom. */
  message: string
  clubId?: string
  clubName?: string
  count?: number
}

export interface OpsHealth {
  poller: PollerHealth
  issues: HealthIssue[]
  /** Rows in the WhatsApp dedup log — should stay small; the daily cron prunes >24h. */
  webhookDedupRows: number
  checkedAt: Date
}

@Injectable()
export class OpsHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  async get(): Promise<OpsHealth> {
    const now = new Date()
    const poller = this.payments.getPollerHealth()

    const today = todayKey()
    const [clubs, stuckPendings, receipts, advisorWaiting, webhookDedupRows, monthCredits] = await Promise.all([
      this.prisma.club.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          mpTokenExpiresAt: true,
          ...paymentSetupSelect,
          subscriptionStatus: true,
          _count: { select: { courts: true, whatsappLines: true } },
        },
      }),
      // PENDING_PAYMENT whose link expired well over the grace window and nobody resolved:
      // the expiry sweep should have cancelled these. If they pile up, the sweep is dead.
      this.prisma.booking.groupBy({
        by: ['clubId'],
        where: {
          status: 'PENDING_PAYMENT',
          paymentExpiresAt: { lt: new Date(now.getTime() - STUCK_GRACE_MS) },
        },
        _count: true,
      }),
      // A player sent a receipt and it's still unreviewed — their money is in limbo.
      this.prisma.booking.groupBy({
        by: ['clubId'],
        where: { status: 'PENDING_PAYMENT', receiptUploadedAt: { not: null } },
        _count: true,
      }),
      this.prisma.conversationSession.groupBy({
        by: ['clubId'],
        where: { needsAdvisor: true },
        _count: true,
      }),
      this.prisma.processedWebhookMessage.count(),
      this.prisma.whatsAppMessageDaily.groupBy({
        by: ['clubId'],
        where: { dateKey: { gte: monthStartKey(today), lte: today } },
        _sum: { botService: true, utility: true },
      }),
    ])
    const creditsUsed = new Map(monthCredits.map(c => [c.clubId, (c._sum.botService ?? 0) + (c._sum.utility ?? 0)]))

    const clubName = new Map(clubs.map(c => [c.id, c.name]))
    const issues: HealthIssue[] = []

    if (poller.consecutiveFailures > 0) {
      issues.push({
        kind: 'POLLER_DOWN',
        severity: 'critical',
        message:
          `El poller de pagos falló ${poller.consecutiveFailures} ${plural(poller.consecutiveFailures, 'vez', 'veces')} seguidas. ` +
          'Nadie está conciliando transferencias ahora mismo.',
        count: poller.consecutiveFailures,
      })
    }

    for (const club of poller.failingClubs) {
      issues.push({
        kind: 'CLUB_MP_FAILING',
        severity: 'critical',
        message: `MercadoPago de ${clubName.get(club.clubId) ?? club.clubId} viene fallando (${club.consecutiveFailures} intentos). Puede ser el token vencido.`,
        clubId: club.clubId,
        clubName: clubName.get(club.clubId),
        count: club.consecutiveFailures,
      })
    }

    for (const row of stuckPendings) {
      issues.push({
        kind: 'STUCK_PENDING',
        severity: 'critical',
        message: `${row._count} ${plural(row._count, 'reserva', 'reservas')} de ${clubName.get(row.clubId) ?? row.clubId} venció${row._count === 1 ? '' : 'ieron'} sin resolverse. La cancha quedó bloqueada.`,
        clubId: row.clubId,
        clubName: clubName.get(row.clubId),
        count: row._count,
      })
    }

    for (const row of receipts) {
      issues.push({
        kind: 'RECEIPT_AWAITING_REVIEW',
        severity: 'warning',
        message: `${row._count} ${plural(row._count, 'comprobante', 'comprobantes')} sin revisar en ${clubName.get(row.clubId) ?? row.clubId}. El jugador ya pagó y está esperando.`,
        clubId: row.clubId,
        clubName: clubName.get(row.clubId),
        count: row._count,
      })
    }

    for (const row of advisorWaiting) {
      issues.push({
        kind: 'ADVISOR_WAITING',
        severity: 'warning',
        message: `${row._count} ${plural(row._count, 'jugador', 'jugadores')} de ${clubName.get(row.clubId) ?? row.clubId} pidió hablar con una persona y nadie contestó.`,
        clubId: row.clubId,
        clubName: clubName.get(row.clubId),
        count: row._count,
      })
    }

    for (const club of clubs) {
      if (club.mpTokenExpiresAt && club.mpTokenExpiresAt.getTime() - now.getTime() < TOKEN_WARNING_MS) {
        issues.push({
          kind: 'MP_TOKEN_EXPIRING',
          severity: 'warning',
          message: `El token de MercadoPago de ${club.name} vence pronto. El poller lo renueva solo, pero si falla la conciliación se corta.`,
          clubId: club.id,
          clubName: club.name,
        })
      }

      // Its month's credits ran out: the bot doesn't answer until it moves to a bigger plan.
      const plan = planDefinition(club.plan)
      const used = creditsUsed.get(club.id) ?? 0
      if (plan && creditsPaused(used, plan.aiCredits, club.slug === SALES_DEMO_SLUG)) {
        const next = nextPlanWithRoom(p => p.aiCredits, used)
        issues.push({
          kind: 'BOT_PAUSED_NO_CREDITS',
          severity: 'critical',
          message:
            `El bot de ${club.name} está pausado: usó sus ${plan.aiCredits.toLocaleString('es-AR')} créditos del mes ` +
            `(plan ${plan.name}). ${next ? `Ofrecele pasar a ${next.name}.` : 'Ningún plan le alcanza: hablalo con el club.'}`,
          clubId: club.id,
          clubName: club.name,
        })
      }

      // A club that pays (or is on trial) but cannot take a booking end to end is a club
      // we onboarded badly — and it will churn without ever telling us why.
      const paymentsReady = paymentsConfigured(club)
      const live = club._count.courts > 0 && paymentsReady && club._count.whatsappLines > 0
      if (!live && club.subscriptionStatus !== 'CANCELLED') {
        const missing = [
          club._count.courts === 0 && 'canchas',
          !paymentsReady && 'cobros',
          club._count.whatsappLines === 0 && 'línea de WhatsApp',
        ].filter(Boolean)
        issues.push({
          kind: 'CLUB_NOT_LIVE',
          severity: 'warning',
          message: `${club.name} no puede tomar una reserva: le falta ${missing.join(' y ')}.`,
          clubId: club.id,
          clubName: club.name,
        })
      }
    }

    // Critical first — the on-call reads top-down and should never scroll to find the fire.
    issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1))

    return { poller, issues, webhookDedupRows, checkedAt: now }
  }
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}
