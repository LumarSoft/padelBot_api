/**
 * What we charge per plan, in cents/month. Manual billing means the price lives nowhere in
 * the DB — without this the console cannot show an MRR, so it's config rather than a
 * hardcoded number we'd forget to update after the first price change.
 *
 * PLAN_PRICE_BASE_CENTS / PLAN_PRICE_PRO_CENTS. An unknown plan contributes 0 to the MRR
 * (visible as such in the console) instead of silently guessing a price.
 */
export function planPriceCents(plan: string): number {
  const key = `PLAN_PRICE_${plan.toUpperCase()}_CENTS`
  return Number(process.env[key]) || 0
}
