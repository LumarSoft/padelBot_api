import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { todayKey } from '../availability/lib/datetime'
import { notifyOps } from '../common/ops-alert'
import { schedulerEnabled } from '../common/scheduling'

/** Which dollar the costs are converted with. */
export const DOLLAR_QUOTES = ['tarjeta', 'oficial'] as const
export type DollarQuote = (typeof DOLLAR_QUOTES)[number]

/**
 * "tarjeta" unless USD_ARS_QUOTE says "oficial": Meta and OpenAI charge Lumarsoft's card in
 * dollars, and an Argentine card pays them at the card rate (oficial + the 30% tax advance).
 * The conservative choice — it never shows a margin better than the real one.
 */
export function dollarQuote(): DollarQuote {
  const quote = process.env.USD_ARS_QUOTE as DollarQuote | undefined
  return quote && DOLLAR_QUOTES.includes(quote) ? quote : 'tarjeta'
}

/** Rates of 2026-10-14, used only until the first fetch lands (and nothing is configured). */
const DEFAULT_RATES: Record<DollarQuote, number> = { tarjeta: 1995.5, oficial: 1535 }

/** A stored rate older than this means the daily fetch keeps failing: ops is told. */
const STALE_DAYS = 3
const DAY_MS = 24 * 60 * 60 * 1000

export interface UsdArs {
  /** Pesos per dollar. */
  rate: number
  quote: DollarQuote
  /** dolarapi = fetched; config = USD_ARS_RATE; default = the built-in rate of 2026-10-14. */
  source: 'dolarapi' | 'config' | 'default'
  /** Day of the fetched quote; null when it isn't a fetched one. */
  dateKey: string | null
}

/**
 * Keeps the dollar up to date on its own: every day (and on boot, if today's is missing) it
 * fetches the quote from dolarapi.com and stores it. Reading a month uses the last quote of that
 * month, so past months keep their rate. If fetching fails, the last stored rate keeps working
 * and ops is told after a few days; without any, USD_ARS_RATE, then a built-in rate.
 */
@Injectable()
export class ExchangeRateService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExchangeRateService.name)

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    if (!schedulerEnabled()) return
    void this.refresh().catch(err => this.logger.error('Could not fetch the dollar on boot', err))
  }

  @Cron('0 12 * * *', { timeZone: process.env.CLUB_TIMEZONE ?? 'America/Argentina/Buenos_Aires' })
  async refreshDaily(): Promise<void> {
    if (!schedulerEnabled()) return
    try {
      await this.refresh()
    } catch (err) {
      this.logger.error('Could not fetch the dollar', err)
    }
    await this.alertIfStale()
  }

  /** Fetches today's quote and stores it. Returns the rate, or null when it couldn't. */
  async refresh(quote: DollarQuote = dollarQuote()): Promise<number | null> {
    const res = await fetch(`https://dolarapi.com/v1/dolares/${quote}`, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) {
      this.logger.error(`dolarapi.com answered ${res.status}`)
      return null
    }
    const { venta } = (await res.json()) as { venta?: unknown }
    const rate = Number(venta)
    // A rate far off what a dollar costs is a broken answer, not news: keep the last good one.
    if (!Number.isFinite(rate) || rate < 100 || rate > 100_000) {
      this.logger.error(`dolarapi.com sent an unusable rate: ${String(venta)}`)
      return null
    }
    const dateKey = todayKey()
    const arsCents = Math.round(rate * 100)
    await this.prisma.exchangeRate.upsert({
      where: { quote_dateKey: { quote, dateKey } },
      create: { quote, dateKey, arsCents, source: 'dolarapi' },
      update: { arsCents, fetchedAt: new Date() },
    })
    return rate
  }

  /** The dollar for a month ("2026-10"): its last stored quote, else config, else the default. */
  async rateFor(month: string, quote: DollarQuote = dollarQuote()): Promise<UsdArs> {
    const stored = await this.prisma.exchangeRate.findFirst({
      where: { quote, dateKey: { lte: `${month}-31` } },
      orderBy: { dateKey: 'desc' },
      select: { arsCents: true, dateKey: true },
    })
    if (stored) return { rate: stored.arsCents / 100, quote, source: 'dolarapi', dateKey: stored.dateKey }
    const configured = Number(process.env.USD_ARS_RATE)
    if (Number.isFinite(configured) && configured > 0) {
      return { rate: configured, quote, source: 'config', dateKey: null }
    }
    return { rate: DEFAULT_RATES[quote], quote, source: 'default', dateKey: null }
  }

  /** Tells ops when the stored dollar is days old: the console would be pricing with an old one. */
  private async alertIfStale(quote: DollarQuote = dollarQuote()): Promise<void> {
    const latest = await this.prisma.exchangeRate.findFirst({
      where: { quote },
      orderBy: { dateKey: 'desc' },
      select: { arsCents: true, dateKey: true },
    })
    const ageDays = latest
      ? Math.floor((Date.now() - new Date(`${latest.dateKey}T12:00:00Z`).getTime()) / DAY_MS)
      : null
    if (ageDays !== null && ageDays < STALE_DAYS) return
    await notifyOps(
      latest
        ? `⚠️ No pudimos actualizar el dólar ${quote} hace ${ageDays} días (dolarapi.com). ` +
            `La consola sigue con $${(latest.arsCents / 100).toLocaleString('es-AR')} del ${latest.dateKey}.`
        : `⚠️ Todavía no pudimos traer el dólar ${quote} de dolarapi.com: la consola usa USD_ARS_RATE o el valor de respaldo.`,
    )
  }
}
