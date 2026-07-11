import { SubscriptionStatus } from 'generated/prisma/client'

/** Days the bot keeps working after the trial/paid period ends (soft guard). */
const GRACE_DAYS = Number(process.env.SUBSCRIPTION_GRACE_DAYS) || 7

const DAY_MS = 24 * 60 * 60 * 1000

export interface SubscriptionFields {
  subscriptionStatus: SubscriptionStatus
  plan: string
  trialEndsAt: Date | null
  currentPeriodEnd: Date | null
}

export interface SubscriptionState extends SubscriptionFields {
  /**
   * What the panel should surface:
   * - ok        → nothing
   * - trial     → informative "X days left" banner
   * - warning   → trial/period ended, inside the grace window (nagging banner)
   * - blocked   → grace exhausted or cancelled (bot answers a fallback message)
   */
  severity: 'ok' | 'trial' | 'warning' | 'blocked'
  /** Whether the WhatsApp bot still serves players. NEVER cut abruptly — the player
   *  (and the club's reputation) is who suffers, so warnings precede any block. */
  botAllowed: boolean
  /** Days until the current phase flips (trial end / grace end), when known. */
  daysLeft: number | null
}

/**
 * Derives the effective product state from the stored subscription fields. The stored
 * status is what WE set (manual billing for now); the dates make it decay on its own:
 * an ACTIVE club whose period lapsed behaves as PAST_DUE without anyone touching the DB.
 */
export function subscriptionState(club: SubscriptionFields, now: Date = new Date()): SubscriptionState {
  const base = { ...club, daysLeft: null as number | null }
  const daysUntil = (d: Date) => Math.max(0, Math.ceil((d.getTime() - now.getTime()) / DAY_MS))

  if (club.subscriptionStatus === SubscriptionStatus.CANCELLED) {
    return { ...base, severity: 'blocked', botAllowed: false }
  }

  if (club.subscriptionStatus === SubscriptionStatus.TRIAL) {
    // No fixed end (legacy/manual clubs) → full access.
    if (!club.trialEndsAt || club.trialEndsAt > now) {
      return {
        ...base,
        severity: 'trial',
        botAllowed: true,
        daysLeft: club.trialEndsAt ? daysUntil(club.trialEndsAt) : null,
      }
    }
    return gracedState(base, club.trialEndsAt, now)
  }

  // ACTIVE / PAST_DUE share the same date math: fine until currentPeriodEnd, then grace.
  if (!club.currentPeriodEnd || club.currentPeriodEnd > now) {
    const explicitlyPastDue = club.subscriptionStatus === SubscriptionStatus.PAST_DUE
    return { ...base, severity: explicitlyPastDue ? 'warning' : 'ok', botAllowed: true }
  }
  return gracedState(base, club.currentPeriodEnd, now)
}

function gracedState(
  base: SubscriptionFields & { daysLeft: number | null },
  phaseEnd: Date,
  now: Date,
): SubscriptionState {
  const graceEnd = new Date(phaseEnd.getTime() + GRACE_DAYS * DAY_MS)
  if (now < graceEnd) {
    return {
      ...base,
      severity: 'warning',
      botAllowed: true,
      daysLeft: Math.max(0, Math.ceil((graceEnd.getTime() - now.getTime()) / DAY_MS)),
    }
  }
  return { ...base, severity: 'blocked', botAllowed: false }
}

/** Prisma `select` fragment for the subscription fields. */
export const subscriptionSelect = {
  subscriptionStatus: true,
  plan: true,
  trialEndsAt: true,
  currentPeriodEnd: true,
} as const
