/**
 * One word per club for the ops console — "how is this club doing, and do I have to act?" —
 * derived from data the tenants table already has. The status is the most urgent one that
 * applies; `reasons` lists every signal behind it, in plain Spanish, so nobody has to read six
 * columns to know why.
 */

export type ClubHealthStatus =
  /** The bot no longer answers: cancelled, or past the grace window. */
  | 'inactive'
  /** It can't take a booking yet: no courts, no payment setup or no WhatsApp line. */
  | 'setup'
  /** Paying (or meant to) but slipping away: lapsed, nobody opens the panel, the bot books nothing. */
  | 'atRisk'
  /** Used more than its plan + packs this month: costing us money without paying for it. */
  | 'overCredits'
  /** Free month ending in a few days: the moment to close the sale. */
  | 'trialEnding'
  /** In its free month and already taking bookings. */
  | 'starting'
  /** Paying, live and the bot books on its own. */
  | 'healthy'

/** Most urgent first: the order the console sorts by. */
export const CLUB_HEALTH_ORDER: readonly ClubHealthStatus[] = [
  'inactive',
  'atRisk',
  'overCredits',
  'trialEnding',
  'setup',
  'starting',
  'healthy',
]

/** A trial with this many days left or fewer is "por vencer". */
export const TRIAL_ENDING_DAYS = 5
/** A live club this old whose bot booked nothing in 30 days is at risk (a new one gets time). */
const QUIET_BOT_AFTER_DAYS = 14

export interface ClubHealthInput {
  createdAt: Date
  subscription: {
    subscriptionStatus: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED'
    severity: 'ok' | 'trial' | 'warning' | 'blocked'
    daysLeft: number | null
  }
  readiness: { courts: number; paymentsConfigured: boolean; whatsappLines: number; ready: boolean }
  activity: { bookingsBot: number; dormant: boolean }
  /** This month's credits against plan + packs (null = no allowance, an unknown plan). */
  credits: { used: number; available: number | null }
}

export interface ClubHealth {
  status: ClubHealthStatus
  reasons: string[]
}

const DAY_MS = 24 * 60 * 60 * 1000

export function clubHealth(club: ClubHealthInput, now: Date = new Date()): ClubHealth {
  const { subscription, readiness, activity, credits } = club
  const isTrial = subscription.subscriptionStatus === 'TRIAL'
  const ageDays = Math.floor((now.getTime() - club.createdAt.getTime()) / DAY_MS)
  const statuses = new Set<ClubHealthStatus>()
  const reasons: string[] = []

  if (subscription.severity === 'blocked') {
    statuses.add('inactive')
    reasons.push(
      subscription.subscriptionStatus === 'CANCELLED' ? 'Suscripción cancelada' : 'Venció y pasaron los días de gracia',
    )
  }

  if (!readiness.ready) {
    statuses.add('setup')
    const missing = [
      readiness.courts === 0 && 'canchas',
      !readiness.paymentsConfigured && 'cobros',
      readiness.whatsappLines === 0 && 'WhatsApp',
    ].filter(Boolean)
    reasons.push(`Le falta: ${missing.join(', ')}`)
  }

  if (subscription.severity === 'warning') {
    statuses.add('atRisk')
    reasons.push(
      subscription.daysLeft !== null
        ? `Vencida: el bot deja de atender en ${subscription.daysLeft} día${subscription.daysLeft === 1 ? '' : 's'}`
        : 'Suscripción vencida',
    )
  }
  if (activity.dormant) {
    statuses.add('atRisk')
    reasons.push('Nadie entra al panel hace más de 14 días')
  }
  if (readiness.ready && activity.bookingsBot === 0 && ageDays >= QUIET_BOT_AFTER_DAYS) {
    statuses.add('atRisk')
    reasons.push('El bot no tomó reservas en 30 días')
  }

  if (credits.available !== null && credits.used > credits.available) {
    statuses.add('overCredits')
    reasons.push(`Pasado de créditos: ${credits.used} de ${credits.available} este mes`)
  }

  if (isTrial && subscription.daysLeft !== null && subscription.daysLeft <= TRIAL_ENDING_DAYS) {
    statuses.add('trialEnding')
    reasons.push(
      subscription.daysLeft === 0
        ? 'La prueba termina hoy'
        : `La prueba termina en ${subscription.daysLeft} día${subscription.daysLeft === 1 ? '' : 's'}`,
    )
  }

  if (isTrial) statuses.add('starting')
  statuses.add('healthy')

  const status = CLUB_HEALTH_ORDER.find(candidate => statuses.has(candidate))!
  return { status, reasons }
}
