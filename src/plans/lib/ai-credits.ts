/**
 * Credits ("créditos de IA" in the panel and on the landing): what a plan's monthly allowance is
 * counted in.
 *
 * One credit = one WhatsApp message the BOT sends: replies, buttons, payment notices, reminders,
 * fijo confirmations (`WhatsAppMessageDaily.botService + utility`). Understanding audios and
 * reading receipts is included and costs nothing — the AI is cheap, Meta's per-message price is
 * what costs us. Replies the staff types from the panel are never the club's credits.
 *
 * Past the month's plan credits, messages spend the club's credit packs (soonest expiry first).
 * Without packs, going over is only measured: the bot keeps working, the owner sees it in the
 * panel and ops gets an alert. Nothing here may cut the bot.
 */

/** Usage that triggers an ops alert, once per club and month each. */
export const AI_CREDIT_ALERT_PERCENTS = [80, 100] as const
export type AiCreditAlertPercent = (typeof AI_CREDIT_ALERT_PERCENTS)[number]

/** "2026-10-14" → "2026-10": the calendar month the allowance resets on. */
export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7)
}

/** "2026-10-14" → "2026-10-01", the lower bound of a month's day keys. */
export function monthStartKey(dateKey: string): string {
  return `${monthKeyOf(dateKey)}-01`
}

/** Whole percentage of the allowance used (can pass 100); null without an allowance. */
export function creditPercent(used: number, allowance: number | null): number | null {
  if (!allowance) return null
  // Integer math first: 3450 / 3000 * 100 is 114.99999… in floating point.
  return Math.floor((used * 100) / allowance)
}

/** The highest alert threshold crossed, or null below the first one. */
export function crossedAlertPercent(used: number, allowance: number | null): AiCreditAlertPercent | null {
  const percent = creditPercent(used, allowance)
  if (percent === null) return null
  return [...AI_CREDIT_ALERT_PERCENTS].reverse().find(threshold => percent >= threshold) ?? null
}

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

/** "2026-10" → "octubre". */
export function monthName(monthKey: string): string {
  return MONTHS[Number(monthKey.slice(5, 7)) - 1] ?? monthKey
}

/** Level of the owner's "te quedan pocos créditos" notice: against plan + pack credits. */
export type CreditsNoticeLevel = 80 | 100

export function creditsNoticeLevel(used: number, available: number | null): CreditsNoticeLevel | null {
  if (!available) return null
  const percent = Math.floor((used * 100) / available)
  return percent >= 100 ? 100 : percent >= 80 ? 80 : null
}

/** What `User.creditsNoticeDismissed` stores for a closed notice: "2026-10:80". */
export function creditsNoticeKey(month: string, level: CreditsNoticeLevel): string {
  return `${month}:${level}`
}
