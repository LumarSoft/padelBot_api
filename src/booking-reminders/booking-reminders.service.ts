import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { WhatsAppService } from '../whatsapp/whatsapp.service'
import { WhatsAppLinesService } from '../whatsapp-lines/whatsapp-lines.service'
import { formatTime } from '../availability/lib/datetime'

/** How long before the slot start the reminder goes out (default 60 min). */
const LEAD_MINUTES = Number(process.env.BOOKING_REMINDER_LEAD_MINUTES) || 60
/** Sweep cadence, matched to the @Cron interval below so every booking lands in exactly one bucket. */
const SWEEP_MINUTES = 5

interface ReminderCandidate {
  id: string
  clubId: string
  playerName: string
  playerPhone: string | null
  slot: { startsAt: Date; court: { name: string } }
}

@Injectable()
export class BookingRemindersService {
  private readonly logger = new Logger(BookingRemindersService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
    private readonly whatsappLines: WhatsAppLinesService,
  ) {}

  private get templateName() {
    return process.env.WHATSAPP_REMINDER_TEMPLATE_NAME ?? 'recordatorio_turno'
  }
  private get templateLanguage() {
    return process.env.WHATSAPP_REMINDER_TEMPLATE_LANG ?? 'es_AR'
  }

  /**
   * Sends a pre-match WhatsApp reminder for confirmed bookings whose slot starts in
   * ~LEAD_MINUTES. The [windowStart, windowEnd) bucket advances with `now` on every sweep, so
   * as long as this runs every SWEEP_MINUTES a booking falls into exactly one sweep — no
   * duplicates, no gaps. `reminderSentAt` is the belt-and-suspenders guard against double-sends.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async sendUpcomingReminders(): Promise<void> {
    const now = Date.now()
    const windowStart = new Date(now + LEAD_MINUTES * 60_000)
    const windowEnd = new Date(now + (LEAD_MINUTES + SWEEP_MINUTES) * 60_000)

    const bookings = await this.prisma.booking.findMany({
      where: {
        status: 'CONFIRMED',
        reminderSentAt: null,
        playerPhone: { not: null },
        slot: { startsAt: { gte: windowStart, lt: windowEnd } },
      },
      select: {
        id: true,
        clubId: true,
        playerName: true,
        playerPhone: true,
        slot: { select: { startsAt: true, court: { select: { name: true } } } },
      },
    })

    for (const booking of bookings) {
      await this.remindOne(booking)
    }
  }

  /** Best-effort: a reminder failure must never block another reminder or any booking flow. */
  private async remindOne(booking: ReminderCandidate): Promise<void> {
    if (!booking.playerPhone) return
    try {
      const line = await this.whatsappLines.findActiveForClub(booking.clubId)
      if (!line) {
        this.logger.warn(`No active WhatsApp line for club ${booking.clubId}, skipping reminder ${booking.id}`)
        return
      }

      await this.whatsapp.sendTemplate(
        line.phoneNumberId,
        booking.playerPhone,
        this.templateName,
        this.templateLanguage,
        [booking.playerName, booking.slot.court.name, formatTime(booking.slot.startsAt)],
      )

      await this.prisma.booking.update({
        where: { id: booking.id },
        data: { reminderSentAt: new Date() },
      })
    } catch (err) {
      this.logger.error(`Failed to send reminder for booking ${booking.id}`, err)
    }
  }
}
