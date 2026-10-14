/**
 * AI credits: what a plan's monthly AI allowance is counted in.
 *
 * One credit = one AI step: understanding a message, transcribing an audio, reading an image or
 * a receipt (the landing's own wording). Messages the bot resolves without AI (menu, buttons,
 * plain dates and times) cost nothing. Each step is one `LlmUsageDaily.calls`, so a month's
 * credits are the sum of `calls` over that month's club-local day keys.
 *
 * Going over is never enforced: the bot keeps working, the owner sees it in the panel and ops
 * gets an alert to talk to the club. Nothing here may cut the bot.
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
