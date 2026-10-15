/**
 * What each club leaves us in a month: what it pays (plan + credit packs) minus what serving it
 * costs (Meta's WhatsApp messages + OpenAI). Pure, so the console's numbers are testable.
 *
 * Meta, as Lumarsoft pays it from its own portfolio: every service message (bot or staff reply
 * inside the 24h window) past the first 1.000 of each number in the month, and every utility
 * template (reminders, fijo confirmations), at one price per message (META_MESSAGE_PRICE_USD,
 * default 0.026). The dollar comes from ExchangeRateService (fetched daily).
 */

/** Service messages Meta doesn't charge, per phone number and month. */
export const FREE_SERVICE_MESSAGES_PER_NUMBER = 1_000

/** Below this margin a paying club is flagged as "low" in the console. */
export const LOW_MARGIN_PERCENT = 30

export function metaMessagePriceUsd(): number {
  return Number(process.env.META_MESSAGE_PRICE_USD) || 0.026
}

/** One number's messages in the month. */
export interface NumberMessages {
  botService: number
  staffService: number
  utility: number
}

export interface MessageCost {
  total: number
  /** Service messages inside the number's free tier. */
  free: number
  /** Billed messages: service past the free tier + every template. */
  paid: number
}

/** Free vs billed messages across a club's numbers (the free tier is per number). */
export function messageCost(numbers: NumberMessages[]): MessageCost {
  let total = 0
  let free = 0
  let paid = 0
  for (const n of numbers) {
    const service = n.botService + n.staffService
    const freeHere = Math.min(service, FREE_SERVICE_MESSAGES_PER_NUMBER)
    total += service + n.utility
    free += freeHere
    paid += service - freeHere + n.utility
  }
  return { total, free, paid }
}

/** USD → ARS cents at the configured rate, rounded to the peso (the console shows round numbers). */
export function usdToArsCents(usd: number, rate: number): number {
  return Math.round(usd * rate) * 100
}

export type MarginFlag = 'negative' | 'low' | 'noRevenue' | null

export interface ClubMonthMoney {
  revenueCents: number
  costCents: number
}

/** Margin in cents and percent, and the flag the console highlights. */
export function margin({ revenueCents, costCents }: ClubMonthMoney): {
  marginCents: number
  marginPercent: number | null
  flag: MarginFlag
} {
  const marginCents = revenueCents - costCents
  const marginPercent = revenueCents > 0 ? Math.round((marginCents / revenueCents) * 100) : null
  // A club in trial costs money by design: it's flagged apart, not as a loss.
  const flag: MarginFlag =
    revenueCents === 0
      ? costCents > 0
        ? 'noRevenue'
        : null
      : marginCents < 0
        ? 'negative'
        : marginPercent !== null && marginPercent < LOW_MARGIN_PERCENT
          ? 'low'
          : null
  return { marginCents, marginPercent, flag }
}
