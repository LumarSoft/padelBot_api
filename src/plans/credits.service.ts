import { Injectable, Logger } from '@nestjs/common'
import { CreditPackStatus } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { todayKey } from '../availability/lib/datetime'
import { KeyedSerialQueue } from '../common/keyed-serial-queue'
import { monthStartKey } from './lib/ai-credits'
import { planDefinition } from './lib/plans'

/** What an outbound WhatsApp message is, for credits (bot) and for our Meta cost (all). */
export type OutboundKind = 'botService' | 'staffService' | 'utility'

/** A credit pack still usable: approved, not expired, with credits left. */
export interface ActivePack {
  id: string
  credits: number
  remaining: number
  expiresAt: Date
}

/** The club's credits in one calendar month. */
export interface MonthCredits {
  /** Messages the bot sent this month (each one a credit). */
  used: number
  /** Of those, how many were paid from credit packs (past the plan's credits). */
  fromPacks: number
}

/** Cache of phoneNumberId → clubId: lines almost never move, and every message asks. */
const LINE_CACHE_MS = 10 * 60 * 1000

/**
 * Counts the club's credits: one per WhatsApp message the bot sends. Every message the Graph API
 * accepts is recorded here (WhatsAppService), and a bot message past the month's plan credits
 * spends one credit of the club's soonest-expiring pack.
 *
 * Recording never throws and never blocks a send — a lost count costs us a fraction of a cent of
 * visibility, a thrown error would cost a reply. Messages of one number are recorded in order
 * (KeyedSerialQueue) so two of them can't both take the last credit of a pack.
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

  /** The bot's messages this month (club-local) and how many came out of packs. */
  async monthCredits(clubId: string, dateKey: string = todayKey()): Promise<MonthCredits> {
    const { _sum } = await this.prisma.whatsAppMessageDaily.aggregate({
      where: { clubId, dateKey: { gte: monthStartKey(dateKey), lte: dateKey } },
      _sum: { botService: true, utility: true, packCredits: true },
    })
    return { used: (_sum.botService ?? 0) + (_sum.utility ?? 0), fromPacks: _sum.packCredits ?? 0 }
  }

  /** Packs the club can still spend, soonest expiry first (the order they're spent in). */
  async activePacks(clubId: string, now: Date = new Date()): Promise<ActivePack[]> {
    const packs = await this.prisma.creditPackPurchase.findMany({
      where: { clubId, status: CreditPackStatus.APPROVED, expiresAt: { gt: now } },
      select: { id: true, credits: true, creditsUsed: true, expiresAt: true },
      orderBy: [{ expiresAt: 'asc' }, { approvedAt: 'asc' }],
    })
    return packs
      .filter(p => p.creditsUsed < p.credits)
      .map(p => ({ id: p.id, credits: p.credits, remaining: p.credits - p.creditsUsed, expiresAt: p.expiresAt! }))
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
    if (kind !== 'staffService') await this.spendPackIfPastPlan(clubId, phoneNumberId, dateKey)
  }

  /** Past the month's plan credits, this message is paid by the soonest-expiring pack. */
  private async spendPackIfPastPlan(clubId: string, phoneNumberId: string, dateKey: string): Promise<void> {
    const [club, month] = await Promise.all([
      this.prisma.club.findUnique({ where: { id: clubId }, select: { plan: true } }),
      this.monthCredits(clubId, dateKey),
    ])
    const plan = club ? planDefinition(club.plan) : null
    if (!plan || month.used <= plan.aiCredits) return

    const [pack] = await this.activePacks(clubId)
    if (!pack) return // No pack: the bot keeps going; the owner and ops are told elsewhere.
    // Guarded on the count we read, so a concurrent spend from another instance can't overdraw.
    const { count } = await this.prisma.creditPackPurchase.updateMany({
      where: { id: pack.id, creditsUsed: pack.credits - pack.remaining },
      data: { creditsUsed: { increment: 1 } },
    })
    if (count === 0) return
    await this.prisma.whatsAppMessageDaily.update({
      where: { phoneNumberId_dateKey: { phoneNumberId, dateKey } },
      data: { packCredits: { increment: 1 } },
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
