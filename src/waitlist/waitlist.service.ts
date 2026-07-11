import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { Subscription } from 'rxjs'
import { PrismaService } from '../prisma/prisma.service'
import { WhatsAppService } from '../whatsapp/whatsapp.service'
import { BookingEventsService, SlotFreedEvent } from '../events/booking-events.service'
import { dayLabelFromKey, formatTime, formatTimeRange, toDateKey, todayKey } from '../availability/lib/datetime'
import { schedulerEnabled } from '../common/scheduling'

/** Minimum gap between freed-slot notifications to the same entry (burst throttle). */
const NOTIFY_THROTTLE_MS = 10 * 60 * 1000

@Injectable()
export class WaitlistService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WaitlistService.name)
  private subscription: Subscription | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
    private readonly events: BookingEventsService,
  ) {}

  onModuleInit(): void {
    // In-process fan-out: whenever a slot frees anywhere, offer it to that day's waitlist.
    this.subscription = this.events.all().subscribe(event => {
      if (event.type === 'slot.freed') {
        void this.notifyFreedSlot(event).catch(err => this.logger.error('Waitlist broadcast failed', err))
      }
    })
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe()
  }

  /** The bot calls this when the player answers "avisame" on a no-availability day. */
  async join(clubId: string, waId: string, dateKey: string, playerName?: string | null): Promise<void> {
    await this.prisma.waitlistEntry.upsert({
      where: { clubId_waId_dateKey: { clubId, waId, dateKey } },
      create: { clubId, waId, dateKey, playerName: playerName ?? null },
      update: { ...(playerName ? { playerName } : {}) },
    })
  }

  /**
   * Broadcasts a freed slot to that day's waitlist and pre-seeds each player's bot
   * session at the CONFIRM step, so answering "sí" books it through the normal flow —
   * the atomic slot lock makes "primero que confirma, gana" true by construction.
   * Converts a cancellation (lost money) into occupancy (recovered money).
   */
  private async notifyFreedSlot(event: SlotFreedEvent): Promise<void> {
    const startsAt = new Date(event.startsAt)
    if (startsAt <= new Date()) return

    const dateKey = toDateKey(startsAt)
    const throttleBefore = new Date(Date.now() - NOTIFY_THROTTLE_MS)
    const entries = await this.prisma.waitlistEntry.findMany({
      where: {
        clubId: event.clubId,
        dateKey,
        OR: [{ notifiedAt: null }, { notifiedAt: { lt: throttleBefore } }],
      },
      select: { id: true, waId: true, playerName: true },
      take: 10,
    })
    if (entries.length === 0) return

    const line = await this.prisma.whatsAppLine.findFirst({
      where: { clubId: event.clubId, isActive: true },
      select: { phoneNumberId: true },
    })
    if (!line) return

    const endsAt = new Date(event.endsAt)
    const bandStart = formatTime(startsAt)
    const label = formatTimeRange(startsAt, endsAt)
    const price = (event.priceCents / 100).toLocaleString('es-AR')

    for (const entry of entries) {
      try {
        await this.seedBookingSession(event, entry, dateKey, bandStart, label)
        const greeting = entry.playerName ? `¡${entry.playerName}, se` : '¡Se'
        await this.whatsapp.sendText(
          line.phoneNumberId,
          entry.waId,
          `🔔 ${greeting} liberó un turno que esperabas!\n\n` +
            `📅 ${dayLabelFromKey(dateKey)} · ${label}\n🎾 ${event.courtName} · $${price}\n\n` +
            `Respondé *sí* para reservarlo — el primero que confirma se lo queda. 🏃`,
        )
        await this.prisma.waitlistEntry.update({ where: { id: entry.id }, data: { notifiedAt: new Date() } })
      } catch (err) {
        this.logger.error(`Failed to notify waitlist entry ${entry.id}`, err)
      }
    }
    this.logger.log(`Waitlist: offered freed ${event.courtName} ${label} (${dateKey}) to ${entries.length} player(s)`)
  }

  /**
   * Points the player's bot session at the freed slot's confirm step. Their "sí" then
   * flows through the standard FSM: pending booking, deposit, atomic lock — no
   * parallel booking path to maintain.
   */
  private async seedBookingSession(
    event: SlotFreedEvent,
    entry: { waId: string; playerName: string | null },
    dateKey: string,
    bandStart: string,
    label: string,
  ): Promise<void> {
    const existing = await this.prisma.conversationSession.findUnique({
      where: { waId_clubId: { waId: entry.waId, clubId: event.clubId } },
      select: { context: true },
    })
    const prevCtx = (existing?.context ?? {}) as Record<string, unknown>

    const playerName = (prevCtx.playerName as string | undefined) ?? entry.playerName ?? undefined
    const context = {
      // Keep identity the player already gave us (name/DNI persist across flows).
      playerName,
      playerDni: typeof prevCtx.playerDni === 'string' ? prevCtx.playerDni : undefined,
      selectedDate: dateKey,
      selectedCourtId: event.courtId,
      selectedCourtName: event.courtName,
      selectedBandStart: bandStart,
      selectedSlotLabel: label,
      selectedSlotPrice: event.priceCents,
    }
    // Without a name the confirm step can't complete — enter at the name question instead.
    const state = playerName ? 'BOOK_CONFIRM' : 'BOOK_NAME'
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000)

    await this.prisma.conversationSession.upsert({
      where: { waId_clubId: { waId: entry.waId, clubId: event.clubId } },
      create: { waId: entry.waId, clubId: event.clubId, state, context, expiresAt, playerName },
      update: { state, context, expiresAt, mode: 'AI' },
    })
  }

  /** Entries whose day already passed are useless — prune daily. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneExpiredEntries(): Promise<void> {
    if (!schedulerEnabled()) return
    try {
      const { count } = await this.prisma.waitlistEntry.deleteMany({ where: { dateKey: { lt: todayKey() } } })
      if (count > 0) this.logger.log(`Pruned ${count} expired waitlist entries`)
    } catch (err) {
      this.logger.error('Failed to prune waitlist entries', err)
    }
  }
}
