/**
 * GTP's commercial plans as the product enforces them. The landing sells the same three, and
 * `front/src/features/landing/lib/plans.ts` is where their prices and copy live: keep the
 * limits and modules here in step with it. What the club pays is config
 * (`PLAN_PRICE_<KEY>_CENTS`, see `ops/lib/pricing.ts`), not part of this catalog.
 *
 * Same philosophy as `clubs/lib/subscription.ts`: a plan never takes anything away abruptly.
 * Limits block CREATING beyond them, modules block TURNING ON, and the AI allowance is only
 * measured and warned about. Whatever a club already has keeps working.
 */

export const PLAN_KEYS = ['saque', 'bandeja', 'smash'] as const
export type PlanKey = (typeof PLAN_KEYS)[number]

/** New clubs (and the DB default) start on the entry plan. */
export const DEFAULT_PLAN: PlanKey = 'saque'

/** Product modules that not every plan includes. */
export const PLAN_FEATURES = [
  'fixedConfirmation',
  'kioscoStock',
  'waitlist',
  'splitPayment',
  'scheduledPriceAdjustments',
] as const
export type PlanFeature = (typeof PLAN_FEATURES)[number]

export interface PlanDefinition {
  key: PlanKey
  name: string
  /** Courts the club can have; null = no limit. */
  courts: number | null
  /** Active panel/app users, the owner included; null = no limit. */
  users: number | null
  /** AI credits included per calendar month. One credit = one AI step (see `ai-credits.ts`). */
  aiCredits: number
  features: readonly PlanFeature[]
  /** We load the club's fijos and players ourselves (a service, nothing to switch on). */
  initialDataLoad: boolean
}

export const PLANS: Record<PlanKey, PlanDefinition> = {
  saque: {
    key: 'saque',
    name: 'Saque',
    courts: 2,
    users: 2,
    aiCredits: 1_000,
    features: [],
    initialDataLoad: false,
  },
  bandeja: {
    key: 'bandeja',
    name: 'Bandeja',
    courts: 4,
    users: 5,
    aiCredits: 3_000,
    features: PLAN_FEATURES,
    initialDataLoad: false,
  },
  smash: {
    key: 'smash',
    name: 'Smash',
    courts: null,
    users: null,
    aiCredits: 8_000,
    features: PLAN_FEATURES,
    initialDataLoad: true,
  },
}

export function isPlanKey(value: string): value is PlanKey {
  return (PLAN_KEYS as readonly string[]).includes(value)
}

/** The definition behind a stored key; null for a key we don't know (a typo from a manual edit). */
export function planDefinition(key: string): PlanDefinition | null {
  return isPlanKey(key) ? PLANS[key] : null
}

/** The plan's display name, or the raw key when it's unknown. */
export function planName(key: string): string {
  return planDefinition(key)?.name ?? key
}

/** Whether one more fits under a limit (null = no limit). */
export function fitsOneMore(used: number, limit: number | null): boolean {
  return limit === null || used < limit
}

/** The cheapest plan with room for one more than `used`; null when no plan has it. */
export function nextPlanWithRoom(limitOf: (plan: PlanDefinition) => number | null, used: number): PlanDefinition | null {
  return (
    PLAN_KEYS.map(key => PLANS[key]).find(plan => {
      const limit = limitOf(plan)
      return limit === null || limit > used
    }) ?? null
  )
}
