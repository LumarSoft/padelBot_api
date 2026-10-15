import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { schedulerEnabled } from '../common/scheduling'
import { samePhone, whatsAppRecipient } from '../common/phone'
import { PrismaService } from '../prisma/prisma.service'
import { BookingsService } from '../bookings/bookings.service'
import { NotificationsService } from '../notifications/notifications.service'
import { WhatsAppService } from '../whatsapp/whatsapp.service'
import { WhatsAppLinesService } from '../whatsapp-lines/whatsapp-lines.service'
import { SALES_DEMO_SLUG } from '../demo/sales-demo.seed'
import { formatTime } from '../availability/lib/datetime'
import { CreditsService } from '../plans/credits.service'
import { buildAttendancePayload, parseAttendancePayload } from './lib/payload'
import { attendanceReplies, describeTurno, templateParam } from './lib/messages'

/** Sweep cadence, matched to the @Cron interval so every fijo lands in exactly one ask bucket. */
const SWEEP_MINUTES = 5
/** How long before the turno the staff is pushed about a fijo who never answered (default 2h). */
const ALERT_MINUTES = Number(process.env.FIXED_CONFIRMATION_ALERT_MINUTES) || 120

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/** An active fijo occurrence, CONFIRMED and with a phone to reach. */
const FIJO_TO_REACH = {
  status: 'CONFIRMED',
  recurringBookingId: { not: null },
  deletedAt: null,
  playerPhone: { not: null },
} as const

interface AskCandidate {
  id: string
  playerName: string
  playerPhone: string | null
  slot: { startsAt: Date; court: { name: string } }
}

interface UnansweredFijo {
  id: string
  clubId: string
  playerName: string
  playerPhone: string | null
  slot: { startsAt: Date; court: { name: string } }
}

/**
 * Automatic attendance check for the fijos (turnos fijos), so the front desk stops calling each
 * one to ask "¿venís?":
 *
 * 1. `askUpcoming` — `Club.fixedConfirmationLeadHours` before each fijo turno, the player gets
 *    a Meta template with two quick replies, "Sí, voy" / "No puedo", whose payloads carry the
 *    booking id. Same bucket pattern as the 1h reminder (BookingRemindersService), which skips
 *    any booking that was asked: one template per turno, never two.
 * 2. `handleButtonReply` — the tap. "Sí, voy" marks it; "No puedo" releases ONLY that date (the
 *    RecurringBooking keeps booking the next weeks, and `applyForWeeksAhead` never re-books a
 *    cancelled occurrence) and the freed court goes to the waitlist like any other.
 * 3. `alertUnanswered` — no answer NEVER cancels anything: ALERT_MINUTES before the turno the
 *    staff gets a push with who to call.
 */
@Injectable()
export class FixedConfirmationsService {
  private readonly logger = new Logger(FixedConfirmationsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly notifications: NotificationsService,
    private readonly whatsapp: WhatsAppService,
    private readonly whatsappLines: WhatsAppLinesService,
    private readonly credits: CreditsService,
  ) {}

  private get templateName() {
    return process.env.WHATSAPP_FIXED_CONFIRMATION_TEMPLATE_NAME ?? 'confirmacion_turno_fijo'
  }
  private get templateLanguage() {
    return process.env.WHATSAPP_FIXED_CONFIRMATION_TEMPLATE_LANG ?? 'es_AR'
  }

  // ── 1. Ask ────────────────────────────────────────────────────────────────────

  /**
   * For every club with the check on, asks the fijos whose turno starts in
   * [lead, lead + SWEEP_MINUTES). The bucket advances with `now`, so a booking falls into exactly
   * one sweep and a failed send is never retried in a loop (it falls back to the 1h reminder,
   * since only a delivered question stamps `attendanceAskedAt`).
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async askUpcoming(): Promise<void> {
    if (!schedulerEnabled()) return
    // The sales demo's players are fake numbers — nothing to deliver there.
    const clubs = await this.prisma.club.findMany({
      where: { fixedConfirmationEnabled: true, slug: { not: SALES_DEMO_SLUG } },
      select: { id: true, fixedConfirmationLeadHours: true },
    })
    for (const club of clubs) {
      try {
        // Paused bot (credits used up): no "¿venís?". No answer never cancels, so nothing breaks.
        if (await this.credits.botPaused(club.id)) continue
        await this.askForClub(club.id, club.fixedConfirmationLeadHours)
      } catch (err) {
        this.logger.error(`Failed to ask fijos of club ${club.id}`, err)
      }
    }
  }

  private async askForClub(clubId: string, leadHours: number): Promise<void> {
    const windowStart = new Date(Date.now() + leadHours * HOUR_MS)
    const windowEnd = new Date(windowStart.getTime() + SWEEP_MINUTES * MINUTE_MS)

    const bookings = await this.prisma.booking.findMany({
      where: {
        clubId,
        ...FIJO_TO_REACH,
        attendanceAskedAt: null,
        // The front desk may have confirmed them by hand already — don't ask twice.
        attendanceConfirmed: null,
        slot: { startsAt: { gte: windowStart, lt: windowEnd } },
      },
      select: {
        id: true,
        playerName: true,
        playerPhone: true,
        slot: { select: { startsAt: true, court: { select: { name: true } } } },
      },
    })
    if (bookings.length === 0) return

    const line = await this.whatsappLines.findActiveForClub(clubId)
    if (!line) {
      this.logger.warn(`No active WhatsApp line for club ${clubId}, skipping ${bookings.length} fijo question(s)`)
      return
    }

    for (const booking of bookings) {
      await this.askOne(line.phoneNumberId, booking)
    }
  }

  /** Best-effort: one failed question must never block the others. */
  private async askOne(phoneNumberId: string, booking: AskCandidate): Promise<void> {
    const to = whatsAppRecipient(booking.playerPhone)
    if (!to) return

    try {
      const when = describeTurno(booking.slot.startsAt, booking.slot.court.name)
      const delivered = await this.whatsapp.sendTemplate(
        phoneNumberId,
        to,
        this.templateName,
        this.templateLanguage,
        [templateParam(booking.playerName), when.day, when.time, templateParam(when.court)],
        [buildAttendancePayload('YES', booking.id), buildAttendancePayload('NO', booking.id)],
      )
      // Graph refused it (template not approved yet, unreachable number): leave it unasked, so the
      // 1h reminder still goes out and the panel doesn't claim we asked.
      if (!delivered) return

      await this.prisma.booking.updateMany({
        where: { id: booking.id, attendanceAskedAt: null },
        data: { attendanceAskedAt: new Date() },
      })
    } catch (err) {
      this.logger.error(`Failed to ask fijo booking ${booking.id}`, err)
    }
  }

  // ── 2. The answer ─────────────────────────────────────────────────────────────

  /**
   * Handles a quick-reply tap on the "¿venís?" template and returns the text to answer with, or
   * null when the payload isn't ours (the caller then treats the tap as a normal message).
   *
   * Tenant + identity first: the booking must belong to the club whose line received the tap AND
   * to the number that tapped — anything else gets a neutral reply and is never acted on.
   * Idempotent: a repeated tap (or a Meta retry that got past the dedup) re-sends the same answer
   * without touching the booking again.
   *
   * The reply goes out even if staff took the chat over (HUMAN mode): it's the receipt of an
   * action the player just took, like a payment confirmation — not the bot joining the chat.
   */
  async handleButtonReply(clubId: string, waId: string, payload: string): Promise<string | null> {
    const parsed = parseAttendancePayload(payload)
    if (!parsed) return null

    const booking = await this.prisma.booking.findFirst({
      where: { id: parsed.bookingId, clubId, deletedAt: null },
      select: {
        id: true,
        playerName: true,
        playerPhone: true,
        status: true,
        recurringBookingId: true,
        attendanceConfirmed: true,
        slot: { select: { startsAt: true, court: { select: { name: true } } } },
      },
    })
    if (!booking || !booking.recurringBookingId || !samePhone(booking.playerPhone, waId)) {
      this.logger.warn(`Fijo answer from ${waId} for booking ${parsed.bookingId} not matched in club ${clubId}`)
      return attendanceReplies.notFound()
    }

    const when = describeTurno(booking.slot.startsAt, booking.slot.court.name)
    if (booking.slot.startsAt.getTime() <= Date.now()) return attendanceReplies.past()

    if (booking.status === 'CANCELLED') {
      if (booking.attendanceConfirmed !== false) return attendanceReplies.cancelledByClub()
      return parsed.answer === 'NO'
        ? attendanceReplies.alreadyReleased(when)
        : attendanceReplies.comingAfterRelease(when)
    }
    if (booking.status !== 'CONFIRMED') return attendanceReplies.notFound()

    if (parsed.answer === 'YES') {
      if (booking.attendanceConfirmed === true) return attendanceReplies.confirmed(when)
      const confirmed = await this.bookings.confirmAttendance(clubId, booking.id)
      return confirmed ? attendanceReplies.confirmed(when) : attendanceReplies.cancelledByClub()
    }

    // "No puedo" — also after a "Sí, voy": plans change, and an early release is what lets the
    // club resell the court.
    try {
      await this.bookings.cancel(clubId, booking.id, { attendanceDeclined: true })
    } catch (err) {
      // Someone (another tap on another instance, the front desk) released it a moment ago.
      if (err instanceof BadRequestException || err instanceof ConflictException) {
        return attendanceReplies.alreadyReleased(when)
      }
      throw err
    }

    void this.notifications.notifyClub(clubId, {
      title: `🔓 ${booking.playerName} no viene ${when.day} a las ${when.time}`,
      body: `Avisó por WhatsApp. ${when.court} quedó libre para reservar.`,
      data: { bookingId: booking.id },
    })
    return attendanceReplies.released(when)
  }

  // ── 3. No answer ──────────────────────────────────────────────────────────────

  /**
   * Fijos that were asked but never answered, with the turno ALERT_MINUTES away or less: one push
   * per club with who to call. Nothing is cancelled — the decision stays with the club.
   * `attendanceAlertSentAt` makes it fire once per booking, even across restarts.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async alertUnanswered(): Promise<void> {
    if (!schedulerEnabled()) return
    const now = new Date()
    const until = new Date(now.getTime() + ALERT_MINUTES * MINUTE_MS)

    const bookings = await this.prisma.booking.findMany({
      where: {
        ...FIJO_TO_REACH,
        attendanceAskedAt: { not: null },
        attendanceConfirmed: null,
        attendanceAlertSentAt: null,
        club: { fixedConfirmationEnabled: true },
        slot: { startsAt: { gt: now, lte: until } },
      },
      select: {
        id: true,
        clubId: true,
        playerName: true,
        playerPhone: true,
        slot: { select: { startsAt: true, court: { select: { name: true } } } },
      },
      orderBy: { slot: { startsAt: 'asc' } },
    })

    const byClub = new Map<string, UnansweredFijo[]>()
    for (const booking of bookings) {
      byClub.set(booking.clubId, [...(byClub.get(booking.clubId) ?? []), booking])
    }

    for (const [clubId, unanswered] of byClub) {
      try {
        await this.notifications.notifyClub(clubId, unansweredPush(unanswered))
        await this.prisma.booking.updateMany({
          where: { id: { in: unanswered.map(b => b.id) } },
          data: { attendanceAlertSentAt: new Date() },
        })
      } catch (err) {
        this.logger.error(`Failed to alert unanswered fijos of club ${clubId}`, err)
      }
    }
  }
}

/** "📞 Juan no respondió si viene" for one; a list with the times for several. */
function unansweredPush(unanswered: UnansweredFijo[]) {
  if (unanswered.length === 1) {
    const [booking] = unanswered
    const time = formatTime(booking.slot.startsAt)
    return {
      title: `📞 ${booking.playerName} no respondió si viene`,
      body:
        `Turno fijo de las ${time} en ${booking.slot.court.name}. ` +
        `Llamalo${booking.playerPhone ? ` al ${booking.playerPhone}` : ''} y marcá qué te dijo en la Agenda.`,
      data: { bookingId: booking.id },
    }
  }
  const names = unanswered.map(b => `${b.playerName} (${formatTime(b.slot.startsAt)})`).join(', ')
  return {
    title: `📞 ${unanswered.length} fijos no respondieron si vienen`,
    body: `${names}. Llamalos desde la Agenda → "Fijos sin respuesta".`,
  }
}
