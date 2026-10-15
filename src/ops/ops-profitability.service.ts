import { Injectable } from '@nestjs/common'
import { CreditPackStatus, SubscriptionStatus } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { toDateKey, todayKey } from '../availability/lib/datetime'
import { monthKeyOf } from '../plans/lib/ai-credits'
import { planDefinition, planName } from '../plans/lib/plans'
import { SALES_DEMO_SLUG } from '../demo/sales-demo.seed'
import { planPriceCents } from './lib/pricing'
import {
  margin,
  MarginFlag,
  messageCost,
  metaMessagePriceUsd,
  effectiveRate,
  mpFeePercent,
  netCents,
  NumberMessages,
  taxRegime,
  TaxRegime,
  usdToArsCents,
} from './lib/profitability'
import { ExchangeRateService, UsdArs } from './exchange-rate.service'
import { chatModelPricing } from '../llm/llm.service'

const DAY_MS = 24 * 60 * 60 * 1000

export interface ClubProfitRow {
  id: string
  name: string
  plan: string
  subscriptionStatus: SubscriptionStatus
  /** The sales demo: shown, never added to the totals. */
  isDemo: boolean
  /** What it pays (`grossCents`), and what that leaves us: without IVA, packs without MP's fee. */
  revenue: { grossCents: number; planCents: number; packsCents: number; totalCents: number }
  messages: { total: number; free: number; paid: number }
  cost: { metaCents: number; aiCents: number; totalCents: number }
  marginCents: number
  marginPercent: number | null
  flag: MarginFlag
  credits: { used: number; included: number | null }
}

export interface ProfitabilityReport {
  month: string
  /** The assumptions behind the pesos, shown in the console. */
  metaMessagePriceUsd: number
  /** The dollar the costs were converted with, and where it came from. */
  usdArs: UsdArs
  /** Where IVA lands (see TAX_REGIME), and MercadoPago's fee on packs. */
  taxRegime: TaxRegime
  mpFeePercent: number
  /**
   * The month's numbers step by step (real clubs only), so the console can explain the margin:
   * what the AI did and cost, what Meta billed, how dollars became pesos.
   */
  breakdown: {
    ai: {
      model: string
      inputPerMTokUsd: number
      outputPerMTokUsd: number
      /** AI steps: messages understood, audios transcribed, images and receipts read. */
      steps: number
      inputTokens: number
      outputTokens: number
      costUsd: number
    }
    meta: { messages: number; free: number; paid: number; costUsd: number }
    /** Pesos per dollar actually paid: the quote, plus the IVA on monotributo. */
    effectiveRate: number
  }
  totals: {
    /** What the clubs paid, IVA included. */
    grossRevenueCents: number
    /** What that leaves us (the margin is over this). */
    revenueCents: number
    costCents: number
    metaCents: number
    aiCents: number
    marginCents: number
    marginPercent: number | null
    messages: { total: number; free: number; paid: number }
  }
  clubs: ClubProfitRow[]
}

/** Clubs that pay their plan this month. Trial and cancelled clubs bring no plan revenue. */
const PAYING = new Set<SubscriptionStatus>([SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE])

/**
 * Per club and month: revenue (plan + packs bought), Meta messages (free vs billed), Meta and
 * OpenAI cost in pesos, and the margin. Plan revenue uses each club's CURRENT plan and status —
 * billing is manual and keeps no history — so a past month is an approximation.
 */
@Injectable()
export class OpsProfitabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: ExchangeRateService,
  ) {}

  async report(month: string = monthKeyOf(todayKey())): Promise<ProfitabilityReport> {
    const from = `${month}-01`
    const to = `${month}-31`
    const priceUsd = metaMessagePriceUsd()
    const usdArs = await this.rates.rateFor(month)
    const regime = taxRegime()
    // On monotributo the IVA on Meta and OpenAI (paid in pesos) is ours to bear.
    const rate = effectiveRate(usdArs.rate, regime)
    const feePercent = mpFeePercent()

    const [clubs, messages, ai, packs] = await Promise.all([
      this.prisma.club.findMany({
        select: { id: true, name: true, slug: true, plan: true, subscriptionStatus: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.whatsAppMessageDaily.groupBy({
        by: ['clubId', 'phoneNumberId'],
        where: { dateKey: { gte: from, lte: to } },
        _sum: { botService: true, staffService: true, utility: true },
      }),
      this.prisma.llmUsageDaily.groupBy({
        by: ['clubId'],
        where: { dateKey: { gte: from, lte: to } },
        _sum: { costMicroUsd: true, calls: true, inputTokens: true, outputTokens: true },
      }),
      // A day either side, then filtered by the club-local day: approvedAt is an instant.
      this.prisma.creditPackPurchase.findMany({
        where: {
          status: CreditPackStatus.APPROVED,
          approvedAt: {
            gte: new Date(`${from}T00:00:00Z`),
            lt: new Date(new Date(`${to}T00:00:00Z`).getTime() + 2 * DAY_MS),
          },
        },
        select: { clubId: true, priceCents: true, approvedAt: true },
      }),
    ])

    const numbersByClub = new Map<string, NumberMessages[]>()
    for (const row of messages) {
      const list = numbersByClub.get(row.clubId) ?? []
      list.push({
        botService: row._sum.botService ?? 0,
        staffService: row._sum.staffService ?? 0,
        utility: row._sum.utility ?? 0,
      })
      numbersByClub.set(row.clubId, list)
    }
    const aiByClub = new Map(ai.map(row => [row.clubId, row._sum.costMicroUsd ?? 0]))
    const packsByClub = new Map<string, number>()
    for (const pack of packs) {
      if (!pack.approvedAt || monthKeyOf(toDateKey(pack.approvedAt)) !== month) continue
      packsByClub.set(pack.clubId, (packsByClub.get(pack.clubId) ?? 0) + pack.priceCents)
    }

    const rows = clubs.map((club): ClubProfitRow => {
      const numbers = numbersByClub.get(club.id) ?? []
      const msgs = messageCost(numbers)
      const planGross = PAYING.has(club.subscriptionStatus) ? planPriceCents(club.plan) : 0
      const packsGross = packsByClub.get(club.id) ?? 0
      // Plans are paid by transfer (no fee); packs go through MercadoPago.
      const planCents = netCents(planGross, { regime })
      const packsCents = netCents(packsGross, { regime, feePercent })
      const metaCents = usdToArsCents(msgs.paid * priceUsd, rate)
      const aiCents = usdToArsCents((aiByClub.get(club.id) ?? 0) / 1_000_000, rate)
      const revenueCents = planCents + packsCents
      const costCents = metaCents + aiCents
      return {
        id: club.id,
        name: club.name,
        plan: planName(club.plan),
        subscriptionStatus: club.subscriptionStatus,
        isDemo: club.slug === SALES_DEMO_SLUG,
        revenue: { grossCents: planGross + packsGross, planCents, packsCents, totalCents: revenueCents },
        messages: msgs,
        cost: { metaCents, aiCents, totalCents: costCents },
        ...margin({ revenueCents, costCents }),
        credits: {
          used: numbers.reduce((sum, n) => sum + n.botService + n.utility, 0),
          included: planDefinition(club.plan)?.aiCredits ?? null,
        },
      }
    })

    const counted = rows.filter(row => !row.isDemo)
    const countedIds = new Set(counted.map(row => row.id))
    const aiTotals = ai
      .filter(row => countedIds.has(row.clubId))
      .reduce(
        (acc, row) => ({
          steps: acc.steps + (row._sum.calls ?? 0),
          inputTokens: acc.inputTokens + (row._sum.inputTokens ?? 0),
          outputTokens: acc.outputTokens + (row._sum.outputTokens ?? 0),
          costMicroUsd: acc.costMicroUsd + (row._sum.costMicroUsd ?? 0),
        }),
        { steps: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 0 },
      )
    const pricing = chatModelPricing()
    const sum = (pick: (row: ClubProfitRow) => number) => counted.reduce((total, row) => total + pick(row), 0)
    const revenueCents = sum(r => r.revenue.totalCents)
    const costCents = sum(r => r.cost.totalCents)
    const totalMargin = margin({ revenueCents, costCents })

    // Worst first: losses, then thin margins, then the rest by margin.
    const order = (row: ClubProfitRow) => (row.flag === 'negative' ? 0 : row.flag === 'low' ? 1 : 2)
    rows.sort((a, b) => order(a) - order(b) || a.marginCents - b.marginCents)

    return {
      month,
      metaMessagePriceUsd: priceUsd,
      usdArs,
      taxRegime: regime,
      mpFeePercent: feePercent,
      breakdown: {
        ai: {
          model: pricing.model,
          inputPerMTokUsd: pricing.inputPerMTok,
          outputPerMTokUsd: pricing.outputPerMTok,
          steps: aiTotals.steps,
          inputTokens: aiTotals.inputTokens,
          outputTokens: aiTotals.outputTokens,
          costUsd: aiTotals.costMicroUsd / 1_000_000,
        },
        meta: {
          messages: sum(r => r.messages.total),
          free: sum(r => r.messages.free),
          paid: sum(r => r.messages.paid),
          costUsd: sum(r => r.messages.paid) * priceUsd,
        },
        effectiveRate: rate,
      },
      totals: {
        grossRevenueCents: sum(r => r.revenue.grossCents),
        revenueCents,
        costCents,
        metaCents: sum(r => r.cost.metaCents),
        aiCents: sum(r => r.cost.aiCents),
        marginCents: totalMargin.marginCents,
        marginPercent: totalMargin.marginPercent,
        messages: {
          total: sum(r => r.messages.total),
          free: sum(r => r.messages.free),
          paid: sum(r => r.messages.paid),
        },
      },
      clubs: rows,
    }
  }
}
