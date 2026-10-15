import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { todayKey } from '../availability/lib/datetime'
import { KeyedSerialQueue } from '../common/keyed-serial-queue'
import { SALES_DEMO_SLUG } from '../demo/sales-demo.seed'
import { creditsPaused, monthStartKey } from './lib/ai-credits'
import { planDefinition } from './lib/plans'

/** What an outbound WhatsApp message is, for credits (bot) and for our Meta cost (all). */
export type OutboundKind = 'botService' | 'staffService' | 'utility'

/** The club's credits this month against its plan, and whether that has paused the bot. */
export interface MonthCreditsState {
  used: number
  /** The plan's credits for the month; null for an unknown plan (never paused). */
  allowance: number | null
  paused: boolean
}

/** Cache of phoneNumberId → clubId: lines almost never move, and every message asks. */
const LINE_CACHE_MS = 10 * 60 * 1000

/**
 * Counts the club's credits: one per WhatsApp message the bot sends. Every message the Graph API
 * accepts is recorded here (WhatsAppService).
 *
 * Recording never throws and never blocks a send — a lost count costs us a fraction of a cent of
 * visibility, a thrown error would cost a reply. Messages of one number are recorded in order
 * (KeyedSerialQueue) so the day's first two can't race to create the same row.
 */
@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name)
  private readonly queue = new KeyedSerialQueue()
  private readonly lineClubs = new Map<string, { clubId: string | null; at: number }>()

  constructor(private readonly prisma: PrismaService) {}

  /** Records one accepted message. Fire-and-forget: resolves even when recording fails. */
  recordSent(phoneNumberId: string, kind: OutboundKind): Promise<void> {
    return this.queue
      .enqueue(phoneNumberId, () => this.record(phoneNumberId, kind))
      .catch(err => this.logger.error(`Could not record a WhatsApp message of ${phoneNumberId}`, err))
  }

  /** The credits the club used this month (club-local): the messages its bot sent. */
  async monthUsed(clubId: string, dateKey: string = todayKey()): Promise<number> {
    const { _sum } = await this.prisma.whatsAppMessageDaily.aggregate({
      where: { clubId, dateKey: { gte: monthStartKey(dateKey), lte: dateKey } },
      _sum: { botService: true, utility: true },
    })
    return (_sum.botService ?? 0) + (_sum.utility ?? 0)
  }

  /** This month's credits against the plan. Read fresh: a plan change un-pauses the bot at once. */
  async monthState(clubId: string, dateKey: string = todayKey()): Promise<MonthCreditsState> {
    const [club, used] = await Promise.all([
      this.prisma.club.findUnique({ where: { id: clubId }, select: { plan: true, slug: true } }),
      this.monthUsed(clubId, dateKey),
    ])
    const allowance = club ? (planDefinition(club.plan)?.aiCredits ?? null) : null
    return { used, allowance, paused: creditsPaused(used, allowance, club?.slug === SALES_DEMO_SLUG) }
  }

  /** Whether the bot must stay quiet: the month's plan credits are used up. */
  async botPaused(clubId: string): Promise<boolean> {
    return (await this.monthState(clubId)).paused
  }

  private async record(phoneNumberId: string, kind: OutboundKind): Promise<void> {
    const clubId = await this.clubOf(phoneNumberId)
    if (!clubId) return
    const dateKey = todayKey()
    await this.prisma.whatsAppMessageDaily.upsert({
      where: { phoneNumberId_dateKey: { phoneNumberId, dateKey } },
      create: { clubId, phoneNumberId, dateKey, [kind]: 1 },
      update: { [kind]: { increment: 1 } },
    })
  }

  private async clubOf(phoneNumberId: string): Promise<string | null> {
    const cached = this.lineClubs.get(phoneNumberId)
    if (cached && Date.now() - cached.at < LINE_CACHE_MS) return cached.clubId
    const line = await this.prisma.whatsAppLine.findUnique({ where: { phoneNumberId }, select: { clubId: true } })
    this.lineClubs.set(phoneNumberId, { clubId: line?.clubId ?? null, at: Date.now() })
    return line?.clubId ?? null
  }
}
