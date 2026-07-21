import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { Cron, CronExpression, Interval } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { BookingsService } from '../bookings/bookings.service'
import { ClubsService } from '../clubs/clubs.service'
import { MercadoPagoService, MpMoneyIn, MpPayment } from '../mercadopago/mercadopago.service'
import { WhatsAppService } from '../whatsapp/whatsapp.service'
import { NotificationsService } from '../notifications/notifications.service'
import { dniFromIdentification, dniMatches } from '../common/identity'
import { schedulerEnabled } from '../common/scheduling'
import { formatDayMonth, formatTimeRange } from '../availability/lib/datetime'

/** One incoming transfer enriched with what the auto-reconciler would do with it. */
export interface MoneyInDiagnostic {
  id: string
  /** True when this movement already confirmed a booking (settled — nothing to assign). */
  alreadyUsed: boolean
  amountCents: number
  amountPesos: number
  dateCreated: Date
  operationType: string
  payerName: string | null
  payerCuit: string | null
  /** DNI derived from the payer's CUIT/CUIL (middle 8 digits), if MP exposed it. */
  derivedDni: string | null
  payerMpUserId: string | null
  payerEmail: string | null
  /** True when MP gave us anything that identifies the payer (the key production question). */
  hasPayerIdentity: boolean
  /** The pending booking this transfer would reconcile against (by exact amount), if any. */
  pendingMatch: {
    bookingId: string
    playerName: string
    transferAmountCents: number
    playerDni: string | null
    dniMatches: boolean
  } | null
}

/** Centavos matter here: the reconciler's whole trick is that two señas differ by cents. */
const formatPesos = (cents: number): string =>
  `$${(cents / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** How far back the poller scans for transfers — a bit over the payment window. */
const POLL_WINDOW_MS = ((Number(process.env.PAYMENT_WINDOW_MIN) || 30) + 5) * 60 * 1000
/** How often to poll MercadoPago for incoming transfers (only hits the API when pendings exist). */
const POLL_INTERVAL_MS = (Number(process.env.PAYMENT_POLL_SECONDS) || 20) * 1000
/** Consecutive poll failures before alerting the club and ops. */
const ALERT_FAILURE_THRESHOLD = Number(process.env.PAYMENT_ALERT_FAILURES) || 3

/**
 * The poller's own state, cross-tenant, for the ops console. Same in-memory counters the
 * per-club health uses — but here the per-club failure map is exposed whole, because the
 * question is "is any club's MercadoPago broken right now", not "is mine".
 */
export interface PollerHealth {
  reconciliationActive: boolean
  lastPollOkAt: Date | null
  consecutiveFailures: number
  /** Clubs whose own-token MercadoPago calls are currently failing (clubId → failure count). */
  failingClubs: { clubId: string; consecutiveFailures: number }[]
}

/** Reconciliation health snapshot for the panel's "reconciliación activa" indicator. */
export interface PaymentsHealth {
  /** True when the poller completed a tick recently (this instance runs the scheduler). */
  reconciliationActive: boolean
  lastPollOkAt: Date | null
  consecutiveFailures: number
  /** Consecutive MercadoPago failures for the CALLER's club (own-token path). */
  clubConsecutiveFailures: number
  /** When the last booking of this club was auto-confirmed from a real transfer. */
  lastAutoConfirmationAt: Date | null
  pendingCount: number
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name)

  // ── Poller health (in-memory; meaningful on the instance running the scheduler) ──
  private lastPollOkAt: Date | null = null
  private consecutivePollFailures = 0
  private globalOutageAlerted = false
  /** Consecutive MercadoPago failures per club (own-token path). */
  private readonly clubPollFailures = new Map<string, number>()
  private readonly clubOutageAlerted = new Set<string>()

  constructor(
    private readonly bookingsService: BookingsService,
    private readonly clubsService: ClubsService,
    private readonly mp: MercadoPagoService,
    private readonly whatsapp: WhatsAppService,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  async handleWebhook(xSignature: string, xRequestId: string, body: unknown): Promise<void> {
    const payload = body as { type?: string; data?: { id?: string } }
    if (payload.type !== 'payment' || !payload.data?.id) return

    const paymentId = String(payload.data.id)

    if (!this.mp.verifyWebhookSignature(paymentId, xRequestId, xSignature)) {
      throw new UnauthorizedException('Invalid webhook signature')
    }

    let payment: MpPayment
    try {
      payment = await this.mp.getPayment(paymentId)
    } catch {
      this.logger.error(`Could not fetch payment ${paymentId} from MercadoPago`)
      return
    }

    if (payment.status === 'approved') {
      // Money-in transfers (the deposit flow) carry no external_reference — reconcile
      // them by the exact amount. Legacy checkout-link payments still carry one.
      if (payment.externalReference) {
        const confirmed = await this.bookingsService.confirmPayment(payment.externalReference, paymentId)
        if (confirmed) await this.sendPaymentConfirmedMessage(payment.externalReference)
      } else {
        await this.handleTransferNotification(payment.amountCents, paymentId)
      }
    } else if (payment.externalReference && (payment.status === 'rejected' || payment.status === 'cancelled')) {
      const cancelled = await this.bookingsService.cancelPending(payment.externalReference)
      if (cancelled) {
        await this.sendPaymentFailedMessage(cancelled.playerPhone, cancelled.clubId)
      }
    }
    // 'pending' / 'in_process' → wait for next webhook notification
  }

  /**
   * Confirms the pending booking whose unique deposit amount matches an incoming
   * transfer, then notifies the player. Shared by the MercadoPago webhook and the
   * external transfer-bridge endpoint, so the notification source stays swappable.
   */
  async handleTransferNotification(amountCents: number, reference: string): Promise<void> {
    const bookingId = await this.bookingsService.confirmPaymentByAmount(amountCents, reference, new Date())
    if (bookingId) await this.sendPaymentConfirmedMessage(bookingId)
  }

  /**
   * Polls MercadoPago for incoming transfers and confirms matching pending bookings.
   * This is the primary reconciliation path: MP does not webhook plain incoming
   * transfers, but exposes them in the payments API. Each movement is matched by its
   * exact amount within the booking's pending window, so re-scanning the same window
   * each tick is safe (already-confirmed bookings simply no longer match).
   *
   * Multi-tenant: each club that connected its OWN MercadoPago account is polled with
   * that account's token and matched scoped to its clubId. Clubs that have NOT connected
   * fall back to the shared env account, polled once and matched globally (amounts are
   * globally unique there). A broken token for one club never blocks the others.
   * Skips everything when nothing is pending.
   */
  @Interval(POLL_INTERVAL_MS)
  async pollIncomingTransfers(): Promise<void> {
    if (!schedulerEnabled()) return
    // The whole tick is guarded so a transient failure (DB hiccup, one club's token) never
    // crashes the scheduler — the next tick simply retries. Per-club errors are already
    // isolated in the reconcile helpers so one broken club can't block the others.
    try {
      const pendingClubIds = await this.pendingClubIds()
      if (pendingClubIds.length === 0) {
        this.recordPollSuccess()
        return
      }

      const since = new Date(Date.now() - POLL_WINDOW_MS)
      let usedSharedAccount = false

      for (const clubId of pendingClubIds) {
        let token: string | null = null
        try {
          token = await this.clubsService.getValidMpAccessToken(clubId)
        } catch (err) {
          this.logger.error(`Could not resolve MercadoPago token for club ${clubId}`, err)
          await this.recordClubPollFailure(clubId, 'no se pudo renovar el token de MercadoPago')
          continue
        }

        if (token) {
          await this.reconcileClub(clubId, token, since)
        } else {
          // No own account → relies on the shared env account; poll it once below.
          usedSharedAccount = true
        }
      }

      if (usedSharedAccount && this.mp.isConfigured) {
        await this.reconcileSharedAccount(since)
      }
      this.recordPollSuccess()
    } catch (err) {
      this.logger.error('Incoming-transfer poll failed', err)
      await this.recordGlobalPollFailure(err)
    }
  }

  /**
   * Distinct clubs that currently have at least one pending-payment booking AND reconcile
   * automatically via MercadoPago. Clubs in RECEIPT mode verify receipts by hand, so they are
   * excluded — the poller never hits MercadoPago for them.
   */
  private async pendingClubIds(): Promise<string[]> {
    const rows = await this.prisma.booking.findMany({
      where: { status: 'PENDING_PAYMENT', club: { paymentVerificationMode: 'AUTO' } },
      select: { clubId: true },
      distinct: ['clubId'],
    })
    return rows.map(r => r.clubId)
  }

  /** Reconciles one club's bookings against its OWN MercadoPago account. */
  private async reconcileClub(clubId: string, token: string, since: Date): Promise<void> {
    let movements: MpMoneyIn[]
    try {
      movements = await this.mp.listRecentMoneyIn(since, token)
    } catch {
      this.logger.error(`MercadoPago poll failed for club ${clubId}`)
      await this.recordClubPollFailure(clubId, 'la consulta a MercadoPago falló')
      return
    }
    this.recordClubPollSuccess(clubId)
    for (const m of movements) {
      const bookingId = await this.bookingsService.confirmPaymentByAmount(m.amountCents, m.id, m.dateCreated, clubId, {
        cuit: m.payerCuit,
        email: m.payerEmail,
        mpUserId: m.payerMpUserId,
      })
      if (bookingId) {
        this.logger.log(`Confirmed booking ${bookingId} from MP transfer ${m.id} (${m.amountCents} cents)`)
        await this.sendPaymentConfirmedMessage(bookingId)
      }
    }
  }

  /** Reconciles bookings of clubs on the shared env account (matched globally by amount). */
  private async reconcileSharedAccount(since: Date): Promise<void> {
    let movements: MpMoneyIn[]
    try {
      movements = await this.mp.listRecentMoneyIn(since)
    } catch {
      return // already logged in the service
    }
    for (const m of movements) {
      const bookingId = await this.bookingsService.confirmPaymentByAmount(
        m.amountCents,
        m.id,
        m.dateCreated,
        undefined,
        {
          cuit: m.payerCuit,
          email: m.payerEmail,
          mpUserId: m.payerMpUserId,
        },
      )
      if (bookingId) {
        this.logger.log(`Confirmed booking ${bookingId} from MP transfer ${m.id} (${m.amountCents} cents)`)
        await this.sendPaymentConfirmedMessage(bookingId)
      }
    }
  }

  /**
   * Read-only diagnostic for the production go/no-go decision: lists the club's recent
   * incoming transfers exactly as the reconciler sees them, exposing what payer identity
   * MercadoPago actually returns (name / CUIT / derived DNI / MP user id) and whether each
   * would match a pending booking. Lets an owner do a real transfer and immediately verify
   * that round-amount + DNI matching is feasible, without touching any booking state.
   * Reads the club's OWN MercadoPago account if connected, else the shared env account.
   */
  async getMoneyInDiagnostics(
    clubId: string,
    minutes: number,
  ): Promise<{
    account: 'own' | 'shared'
    windowMinutes: number
    count: number
    withIdentity: number
    movements: MoneyInDiagnostic[]
  }> {
    const token = await this.clubsService.getValidMpAccessToken(clubId)
    if (!token && !this.mp.isConfigured) {
      throw new BadRequestException(
        'No MercadoPago account is available: connect the club account or set MERCADOPAGO_ACCESS_TOKEN.',
      )
    }

    const since = new Date(Date.now() - minutes * 60 * 1000)
    const movements = await this.mp.listRecentMoneyIn(since, token ?? undefined)

    const pendings = await this.prisma.booking.findMany({
      where: { clubId, status: 'PENDING_PAYMENT' },
      select: { id: true, transferAmountCents: true, playerDni: true, playerName: true },
    })

    // Movements that already confirmed a booking (poller or manual assign) are settled.
    const usedRefs = new Set(
      (
        await this.prisma.booking.findMany({
          where: { mpPaymentId: { in: movements.map(m => m.id) } },
          select: { mpPaymentId: true },
        })
      ).map(b => b.mpPaymentId),
    )

    const enriched: MoneyInDiagnostic[] = movements.map(m => {
      const derivedDni = dniFromIdentification(m.payerCuit)
      const match = pendings.find(p => p.transferAmountCents === m.amountCents) ?? null
      return {
        id: m.id,
        alreadyUsed: usedRefs.has(m.id),
        amountCents: m.amountCents,
        amountPesos: m.amountCents / 100,
        dateCreated: m.dateCreated,
        operationType: m.operationType,
        payerName: m.payerName,
        payerCuit: m.payerCuit,
        derivedDni,
        payerMpUserId: m.payerMpUserId,
        payerEmail: m.payerEmail,
        hasPayerIdentity: !!(m.payerCuit || m.payerMpUserId || m.payerName),
        pendingMatch: match
          ? {
              bookingId: match.id,
              playerName: match.playerName,
              transferAmountCents: match.transferAmountCents!,
              playerDni: match.playerDni,
              dniMatches: dniMatches(match.playerDni, derivedDni),
            }
          : null,
      }
    })

    return {
      account: token ? 'own' : 'shared',
      windowMinutes: minutes,
      count: enriched.length,
      withIdentity: enriched.filter(e => e.hasPayerIdentity).length,
      movements: enriched,
    }
  }

  /**
   * Admin manually confirms a transfer (front-desk verified the money landed) and
   * the player is notified. Club-scoped and idempotent.
   *
   * When a concrete detected transfer is being ASSIGNED (`paymentRef`), the money is real but
   * its AMOUNT still has to cover the deposit. Assigning used to confirm on the reference alone:
   * a $2.500 transfer dropped onto a $10.000 seña marked the deposit fully paid and the club ate
   * the $7.500. The auto-reconciler never had this hole — it only ever matches an exact amount —
   * so the guard belongs here, in front of the manual path.
   */
  async confirmPaymentManually(
    clubId: string,
    bookingId: string,
    payment?: {
      paymentRef?: string | null
      payer?: { cuit?: string | null; email?: string | null; mpUserId?: string | null }
    },
  ): Promise<{ confirmed: boolean }> {
    if (payment?.paymentRef) await this.assertTransferCoversDeposit(clubId, bookingId, payment.paymentRef)

    const confirmedId = await this.bookingsService.confirmPaymentManual(clubId, bookingId, payment)
    if (confirmedId) await this.sendPaymentConfirmedMessage(confirmedId)
    return { confirmed: confirmedId !== null }
  }

  /**
   * Refuses to confirm a deposit with a transfer that doesn't cover it. Fails closed: if the
   * amount can't be read from MercadoPago, the assignment is blocked rather than trusted — the
   * whole point of this check is that we do not take an unverified amount's word for it.
   */
  private async assertTransferCoversDeposit(clubId: string, bookingId: string, paymentRef: string): Promise<void> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, clubId },
      select: { depositCents: true, transferAmountCents: true },
    })
    if (!booking) throw new NotFoundException('Reserva no encontrada')

    const requiredCents = booking.transferAmountCents ?? booking.depositCents
    if (!requiredCents) return

    const token = await this.clubsService.getValidMpAccessToken(clubId)

    let paidCents: number
    try {
      const mpPayment = await this.mp.getPayment(paymentRef, token ?? undefined)
      paidCents = mpPayment.amountCents
    } catch (err) {
      this.logger.error(`Could not read MP payment ${paymentRef} while assigning booking ${bookingId}`, err)
      throw new BadRequestException(
        'No pude verificar el importe de esa transferencia en MercadoPago. Probá de nuevo en un momento.',
      )
    }

    if (paidCents < requiredCents) {
      const missing = formatPesos(requiredCents - paidCents)
      throw new BadRequestException(
        `Esa transferencia es de ${formatPesos(paidCents)} y la seña es de ${formatPesos(requiredCents)}: ` +
          `faltan ${missing}. No la asigno como seña completa — pedile al jugador que transfiera la diferencia, ` +
          `o rechazá la reserva.`,
      )
    }
  }

  /** Admin manually rejects a pending transfer (money never arrived); slot is released. */
  async rejectPaymentManually(clubId: string, bookingId: string): Promise<{ cancelled: boolean }> {
    const info = await this.bookingsService.rejectPayment(clubId, bookingId)
    if (info) await this.sendPaymentFailedMessage(info.playerPhone, info.clubId)
    return { cancelled: info !== null }
  }

  // ── Poller health & alerts ──────────────────────────────────────────────────

  /**
   * Health snapshot for the panel: whether reconciliation is alive, when it last ran
   * OK, and when the caller's club last had a booking auto-confirmed by a real
   * transfer. In-memory poll state is meaningful on the instance running the
   * scheduler (single-instance deploys today; see RUN_SCHEDULER).
   */
  async getHealth(clubId: string): Promise<PaymentsHealth> {
    const [lastConfirmed, pendingCount] = await Promise.all([
      this.prisma.booking.findFirst({
        where: { clubId, status: 'CONFIRMED', mpPaymentId: { not: null } },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
      this.prisma.booking.count({ where: { clubId, status: 'PENDING_PAYMENT' } }),
    ])

    // "Active" = a tick finished OK within the last 3 intervals (min 2 minutes).
    const staleAfterMs = Math.max(3 * POLL_INTERVAL_MS, 2 * 60 * 1000)
    return {
      reconciliationActive: this.lastPollOkAt !== null && Date.now() - this.lastPollOkAt.getTime() < staleAfterMs,
      lastPollOkAt: this.lastPollOkAt,
      consecutiveFailures: this.consecutivePollFailures,
      clubConsecutiveFailures: this.clubPollFailures.get(clubId) ?? 0,
      lastAutoConfirmationAt: lastConfirmed?.updatedAt ?? null,
      pendingCount,
    }
  }

  /**
   * The same poller state, but cross-tenant, for the ops console. No DB work: this is
   * purely the in-memory counters of the instance running the scheduler.
   */
  getPollerHealth(): PollerHealth {
    const staleAfterMs = Math.max(3 * POLL_INTERVAL_MS, 2 * 60 * 1000)
    return {
      reconciliationActive: this.lastPollOkAt !== null && Date.now() - this.lastPollOkAt.getTime() < staleAfterMs,
      lastPollOkAt: this.lastPollOkAt,
      consecutiveFailures: this.consecutivePollFailures,
      failingClubs: [...this.clubPollFailures.entries()]
        .filter(([, failures]) => failures > 0)
        .map(([clubId, consecutiveFailures]) => ({ clubId, consecutiveFailures })),
    }
  }

  private recordPollSuccess(): void {
    this.lastPollOkAt = new Date()
    if (this.globalOutageAlerted) {
      void this.alertOps('✅ PadelBot: el poller de pagos se recuperó y volvió a conciliar normalmente.')
    }
    this.consecutivePollFailures = 0
    this.globalOutageAlerted = false
  }

  private async recordGlobalPollFailure(err: unknown): Promise<void> {
    this.consecutivePollFailures++
    if (this.consecutivePollFailures >= ALERT_FAILURE_THRESHOLD && !this.globalOutageAlerted) {
      this.globalOutageAlerted = true
      await this.alertOps(
        `🔴 PadelBot: el poller de pagos falló ${this.consecutivePollFailures} veces seguidas. ` +
          `Las confirmaciones automáticas están CORTADAS hasta que se resuelva. Último error: ${String(err)}`,
      )
    }
  }

  private recordClubPollSuccess(clubId: string): void {
    this.clubPollFailures.delete(clubId)
    this.clubOutageAlerted.delete(clubId)
  }

  /**
   * Counts consecutive MercadoPago failures for one club and, at the threshold, alerts
   * both the club's staff (push) and ops — an expired/revoked MP token means "la plata
   * entra pero el sistema no confirma", the single most trust-destroying failure.
   */
  private async recordClubPollFailure(clubId: string, reason: string): Promise<void> {
    const failures = (this.clubPollFailures.get(clubId) ?? 0) + 1
    this.clubPollFailures.set(clubId, failures)
    if (failures < ALERT_FAILURE_THRESHOLD || this.clubOutageAlerted.has(clubId)) return
    this.clubOutageAlerted.add(clubId)

    await this.notifications.notifyClub(clubId, {
      title: '⚠️ Problema con MercadoPago',
      body: 'Las confirmaciones automáticas de señas están fallando. Revisá la conexión con MercadoPago en Configuración y confirmá los pagos pendientes a mano mientras tanto.',
    })
    const club = await this.prisma.club.findUnique({ where: { id: clubId }, select: { name: true } })
    await this.alertOps(
      `🔴 PadelBot: la conciliación de MercadoPago del club "${club?.name ?? clubId}" falló ${failures} veces seguidas (${reason}).`,
    )
  }

  /**
   * Ops alert to Lumarsoft via a Slack/Discord-compatible webhook (env
   * OPS_ALERT_WEBHOOK_URL). Best-effort: an alert failure must never break the poller.
   */
  private async alertOps(text: string): Promise<void> {
    const url = process.env.OPS_ALERT_WEBHOOK_URL
    this.logger.error(text)
    if (!url) return
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // "text" (Slack) + "content" (Discord) so either webhook renders it.
        body: JSON.stringify({ text, content: text }),
      })
    } catch (err) {
      this.logger.error('Failed to deliver ops alert webhook', err)
    }
  }

  /** Runs every 5 minutes to cancel bookings whose payment link expired. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async cleanupExpiredPending(): Promise<void> {
    if (!schedulerEnabled()) return
    try {
      const cancelled = await this.bookingsService.findAndCancelExpiredPending()
      for (const b of cancelled) {
        await this.sendPaymentExpiredMessage(b.playerPhone, b.clubId)
      }
    } catch (err) {
      this.logger.error('Expired-pending cleanup failed', err)
    }
  }

  // ── Private WA notifications ────────────────────────────────────────────────

  private async sendPaymentConfirmedMessage(bookingId: string): Promise<void> {
    try {
      const booking = await this.prisma.booking.findUnique({
        where: { id: bookingId },
        select: {
          playerPhone: true,
          clubId: true,
          depositCents: true,
          slot: { select: { startsAt: true, endsAt: true, court: { select: { name: true } } } },
        },
      })
      if (!booking?.playerPhone) return

      const line = await this.findActiveLine(booking.clubId)
      if (!line) return

      const { startsAt, endsAt, court } = booking.slot
      // Wall-clock formatting must go through the CLUB_TIMEZONE helpers: `toLocale*` would
      // render the API host's timezone and tell the player the wrong hour on a UTC server.
      const msg =
        `✅ *¡Reserva confirmada!*\n\n` +
        `📅 ${formatDayMonth(startsAt)} · ${formatTimeRange(startsAt, endsAt)}\n` +
        `🎾 ${court.name}\n\n` +
        `Tu reserva quedó asegurada. ¡Nos vemos en la cancha! 🎾`

      const delivered = await this.whatsapp.sendTextWithRetry(line, booking.playerPhone, msg)
      if (!delivered) {
        await this.alertUndelivered(booking.clubId, booking.playerPhone, 'la CONFIRMACIÓN de la seña')
      }
    } catch (err) {
      this.logger.error('Failed to send payment-confirmed WA message', err)
    }
  }

  /**
   * A critical message that never reached the player is a silent failure: the money is in,
   * the booking is CONFIRMED, and the only person who doesn't know is the one who paid.
   * Push the club's staff so they can call the player, and tell ops — a burst of these is
   * how a WhatsApp outage or a revoked Meta token looks from the outside.
   */
  private async alertUndelivered(clubId: string, playerPhone: string, what: string): Promise<void> {
    await this.notifications.notifyClub(clubId, {
      title: '⚠️ Un mensaje no llegó al jugador',
      body: `WhatsApp no le entregó ${what} al ${playerPhone}. Conviene que lo llamen para confirmarlo a mano.`,
    })
    const club = await this.prisma.club.findUnique({ where: { id: clubId }, select: { name: true } })
    await this.alertOps(
      `🔴 PadelBot: WhatsApp NO entregó ${what} al jugador ${playerPhone} del club "${club?.name ?? clubId}" tras 3 intentos.`,
    )
  }

  private async sendPaymentFailedMessage(playerPhone: string | null, clubId: string): Promise<void> {
    if (!playerPhone) return
    try {
      const line = await this.findActiveLine(clubId)
      if (!line) return
      const delivered = await this.whatsapp.sendTextWithRetry(
        line,
        playerPhone,
        `😕 Tu pago no pudo procesarse y la reserva fue cancelada. Podés intentar reservar nuevamente cuando quieras. 🎾`,
      )
      if (!delivered) await this.alertUndelivered(clubId, playerPhone, 'el aviso de que su pago fue RECHAZADO')
    } catch (err) {
      this.logger.error('Failed to send payment-failed WA message', err)
    }
  }

  private async sendPaymentExpiredMessage(playerPhone: string | null, clubId: string): Promise<void> {
    if (!playerPhone) return
    try {
      const line = await this.findActiveLine(clubId)
      if (!line) return
      const delivered = await this.whatsapp.sendTextWithRetry(
        line,
        playerPhone,
        `⏳ El tiempo para abonar tu reserva venció y el turno quedó libre. Si querés reservarlo de nuevo, escribime y lo gestionamos. 🎾`,
      )
      // Not knowing the slot was released is how a player shows up to a court someone else booked.
      if (!delivered) await this.alertUndelivered(clubId, playerPhone, 'el aviso de que su reserva VENCIÓ')
    } catch (err) {
      this.logger.error('Failed to send payment-expired WA message', err)
    }
  }

  private async findActiveLine(clubId: string): Promise<string | null> {
    const line = await this.prisma.whatsAppLine.findFirst({
      where: { clubId, isActive: true },
      select: { phoneNumberId: true },
    })
    return line?.phoneNumberId ?? null
  }
}
