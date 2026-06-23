import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { Cron, CronExpression, Interval } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { BookingsService } from '../bookings/bookings.service'
import { ClubsService } from '../clubs/clubs.service'
import { MercadoPagoService, MpMoneyIn, MpPayment } from '../mercadopago/mercadopago.service'
import { WhatsAppService } from '../whatsapp/whatsapp.service'

/** How far back the poller scans for transfers — a bit over the payment window. */
const POLL_WINDOW_MS = ((Number(process.env.PAYMENT_WINDOW_MIN) || 30) + 5) * 60 * 1000
/** How often to poll MercadoPago for incoming transfers (only hits the API when pendings exist). */
const POLL_INTERVAL_MS = (Number(process.env.PAYMENT_POLL_SECONDS) || 20) * 1000

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name)

  constructor(
    private readonly bookingsService: BookingsService,
    private readonly clubsService: ClubsService,
    private readonly mp: MercadoPagoService,
    private readonly whatsapp: WhatsAppService,
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
    const pendingClubIds = await this.pendingClubIds()
    if (pendingClubIds.length === 0) return

    const since = new Date(Date.now() - POLL_WINDOW_MS)
    let usedSharedAccount = false

    for (const clubId of pendingClubIds) {
      const token = await this.clubsService.getValidMpAccessToken(clubId)

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
  }

  /** Distinct clubs that currently have at least one pending-payment booking. */
  private async pendingClubIds(): Promise<string[]> {
    const rows = await this.prisma.booking.findMany({
      where: { status: 'PENDING_PAYMENT' },
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
      return
    }
    for (const m of movements) {
      const bookingId = await this.bookingsService.confirmPaymentByAmount(m.amountCents, m.id, m.dateCreated, clubId)
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
      const bookingId = await this.bookingsService.confirmPaymentByAmount(m.amountCents, m.id, m.dateCreated)
      if (bookingId) {
        this.logger.log(`Confirmed booking ${bookingId} from MP transfer ${m.id} (${m.amountCents} cents)`)
        await this.sendPaymentConfirmedMessage(bookingId)
      }
    }
  }

  /**
   * Admin manually confirms a transfer (front-desk verified the money landed) and
   * the player is notified. Club-scoped and idempotent.
   */
  async confirmPaymentManually(clubId: string, bookingId: string): Promise<{ confirmed: boolean }> {
    const confirmedId = await this.bookingsService.confirmPaymentManual(clubId, bookingId)
    if (confirmedId) await this.sendPaymentConfirmedMessage(confirmedId)
    return { confirmed: confirmedId !== null }
  }

  /** Admin manually rejects a pending transfer (money never arrived); slot is released. */
  async rejectPaymentManually(clubId: string, bookingId: string): Promise<{ cancelled: boolean }> {
    const info = await this.bookingsService.rejectPayment(clubId, bookingId)
    if (info) await this.sendPaymentFailedMessage(info.playerPhone, info.clubId)
    return { cancelled: info !== null }
  }

  /** Runs every 5 minutes to cancel bookings whose payment link expired. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async cleanupExpiredPending(): Promise<void> {
    const cancelled = await this.bookingsService.findAndCancelExpiredPending()
    for (const b of cancelled) {
      await this.sendPaymentExpiredMessage(b.playerPhone, b.clubId)
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
      const date = startsAt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
      const start = startsAt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
      const end = endsAt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })

      const msg =
        `✅ *¡Reserva confirmada!*\n\n` +
        `📅 ${date} · ${start} - ${end}\n` +
        `🎾 ${court.name}\n\n` +
        `Tu reserva quedó asegurada. ¡Nos vemos en la cancha! 🎾`

      await this.whatsapp.sendText(line, booking.playerPhone, msg)
    } catch (err) {
      this.logger.error('Failed to send payment-confirmed WA message', err)
    }
  }

  private async sendPaymentFailedMessage(playerPhone: string | null, clubId: string): Promise<void> {
    if (!playerPhone) return
    try {
      const line = await this.findActiveLine(clubId)
      if (!line) return
      await this.whatsapp.sendText(
        line,
        playerPhone,
        `😕 Tu pago no pudo procesarse y la reserva fue cancelada. Podés intentar reservar nuevamente cuando quieras. 🎾`,
      )
    } catch (err) {
      this.logger.error('Failed to send payment-failed WA message', err)
    }
  }

  private async sendPaymentExpiredMessage(playerPhone: string | null, clubId: string): Promise<void> {
    if (!playerPhone) return
    try {
      const line = await this.findActiveLine(clubId)
      if (!line) return
      await this.whatsapp.sendText(
        line,
        playerPhone,
        `⏳ El tiempo para abonar tu reserva venció y el turno quedó libre. Si querés reservarlo de nuevo, escribime y lo gestionamos. 🎾`,
      )
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
