/**
 * Extra credit packs a club buys when its month's plan credits aren't enough. One-off payments by
 * MercadoPago Checkout Pro into Lumarsoft's account. The panel's "Comprar más créditos" modal shows
 * this catalog as the API sends it, so the prices live only here.
 */

export interface CreditPack {
  key: string
  credits: number
  /** ARS cents, like every amount in the app. */
  priceCents: number
  /** The one the modal marks "Más popular" and selects by default. */
  popular: boolean
}

export const CREDIT_PACKS: readonly CreditPack[] = [
  { key: 'pack-500', credits: 500, priceCents: 4_999_900, popular: false },
  { key: 'pack-1000', credits: 1_000, priceCents: 8_999_900, popular: true },
  { key: 'pack-2500', credits: 2_500, priceCents: 19_999_900, popular: false },
]

export const CREDIT_PACK_KEYS = CREDIT_PACKS.map(pack => pack.key)

/** Packs expire this many months after MercadoPago approves the payment. */
export const CREDIT_PACK_VALIDITY_MONTHS = 6

export function creditPack(key: string): CreditPack | null {
  return CREDIT_PACKS.find(pack => pack.key === key) ?? null
}

/** When a pack approved at `approvedAt` stops counting. */
export function packExpiry(approvedAt: Date): Date {
  const expiresAt = new Date(approvedAt)
  expiresAt.setMonth(expiresAt.getMonth() + CREDIT_PACK_VALIDITY_MONTHS)
  return expiresAt
}

/**
 * The `external_reference` of a pack's MercadoPago payment. Prefixed so it can never be mistaken
 * for a booking id by the clubs' payment webhook, should both ever see the same notification.
 */
const REFERENCE_PREFIX = 'gtp-credits:'

export function packReference(purchaseId: string): string {
  return `${REFERENCE_PREFIX}${purchaseId}`
}

/** The purchase id behind an external_reference, or null when it isn't one of ours. */
export function purchaseIdFromReference(reference: string | null | undefined): string | null {
  return reference?.startsWith(REFERENCE_PREFIX) ? reference.slice(REFERENCE_PREFIX.length) : null
}
