/**
 * Credits ("créditos de IA" in the panel and on the landing): what a plan's monthly allowance is
 * counted in.
 *
 * One credit = one WhatsApp message the BOT sends: replies, buttons, payment notices, reminders,
 * fijo confirmations (`WhatsAppMessageDaily.botService + utility`). Understanding audios and
 * reading receipts is included and costs nothing — the AI is cheap, Meta's per-message price is
 * what costs us. Replies the staff types from the panel are never the club's credits.
 *
 * A credit stands for one bot message plus the AI tokens an average message takes, so the plan's
 * credits cover both costs. Ops and the club are warned when 20%, 10% and 5% are left; once the
 * month's plan credits are used up the bot is PAUSED (`creditsPaused`) until the club moves to a
 * bigger plan or the month turns. Paused, it stops answering players and sending reminders, fijo
 * confirmations and waitlist offers; payment messages still go out (that money is already
 * moving) and the staff keeps answering by hand from Conversaciones.
 */

/** Usage that warns ops and the club, once per club and month each: 20%, 10%, 5% left, and none. */
export const AI_CREDIT_ALERT_PERCENTS = [80, 90, 95, 100] as const
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

/** Level of the panel's "te quedan pocos créditos" notice: the alert threshold crossed. */
export type CreditsNoticeLevel = AiCreditAlertPercent

export function creditsNoticeLevel(used: number, allowance: number | null): CreditsNoticeLevel | null {
  return crossedAlertPercent(used, allowance)
}

/**
 * Whether the bot is paused: the month's plan credits are used up. Never for an unknown plan
 * (no allowance) nor for the sales demo, whose usage is simulated.
 */
export function creditsPaused(used: number, allowance: number | null, isDemo = false): boolean {
  return !isDemo && allowance !== null && used >= allowance
}

/** What `User.creditsNoticeDismissed` stores for a closed notice: "2026-10:80". */
export function creditsNoticeKey(month: string, level: CreditsNoticeLevel): string {
  return `${month}:${level}`
}
