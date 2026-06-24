import { weekdayOfKey } from './datetime'

/** A court price exception, as needed to resolve a band's price. */
export interface PriceRule {
  /** 0 = Sunday … 6 = Saturday, or null for every day. */
  dayOfWeek: number | null
  /** "HH:MM" band start the price applies to. */
  startTime: string
  priceCents: number
}

/**
 * Resolves the price (cents) for a band starting at `bandStart` on `dateKey`, applying
 * the court's price exceptions over its default price. A rule specific to the day's
 * weekday wins over an all-days rule (`dayOfWeek = null`); if none match, the default
 * price is used.
 */
export function resolveBandPriceCents(
  defaultPriceCents: number,
  rules: PriceRule[],
  dateKey: string,
  bandStart: string,
): number {
  const weekday = weekdayOfKey(dateKey)
  let dayRule: PriceRule | undefined
  let allDaysRule: PriceRule | undefined

  for (const rule of rules) {
    if (rule.startTime !== bandStart) continue
    if (rule.dayOfWeek === weekday) dayRule = rule
    else if (rule.dayOfWeek === null || rule.dayOfWeek === undefined) allDaysRule = rule
  }

  return (dayRule ?? allDaysRule)?.priceCents ?? defaultPriceCents
}
