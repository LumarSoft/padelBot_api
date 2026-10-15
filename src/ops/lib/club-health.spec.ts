import { clubHealth, ClubHealthInput } from './club-health'

const NOW = new Date('2026-10-15T15:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)

/** A paying, live club whose bot books on its own: healthy unless the test says otherwise. */
function club(over: Partial<ClubHealthInput> = {}): ClubHealthInput {
  return {
    createdAt: daysAgo(60),
    subscription: { subscriptionStatus: 'ACTIVE', severity: 'ok', daysLeft: null },
    readiness: { courts: 3, paymentsConfigured: true, whatsappLines: 1, ready: true },
    activity: { bookingsBot: 120, dormant: false },
    credits: { used: 900, limit: 2_000, paused: false },
    ...over,
  }
}

const trial = (daysLeft: number) => ({ subscriptionStatus: 'TRIAL' as const, severity: 'trial' as const, daysLeft })

/**
 * One word per club for ops, the most urgent one that applies, with every signal behind it so
 * the console says why without six columns to read.
 */
describe('clubHealth', () => {
  it('calls a paying, live club whose bot books "healthy"', () => {
    expect(clubHealth(club(), NOW)).toEqual({ status: 'healthy', reasons: [] })
  })

  it('says what a club that can’t take bookings is missing', () => {
    const result = clubHealth(
      club({ readiness: { courts: 2, paymentsConfigured: false, whatsappLines: 0, ready: false } }),
      NOW,
    )
    expect(result).toEqual({ status: 'setup', reasons: ['Le falta: cobros, WhatsApp'] })
  })

  it('flags a lapsed club, one nobody opens and one whose bot stopped booking as at risk', () => {
    expect(
      clubHealth(club({ subscription: { subscriptionStatus: 'ACTIVE', severity: 'warning', daysLeft: 3 } }), NOW),
    ).toMatchObject({ status: 'atRisk', reasons: ['Vencida: el bot deja de atender en 3 días'] })
    expect(clubHealth(club({ activity: { bookingsBot: 40, dormant: true } }), NOW).status).toBe('atRisk')
    expect(clubHealth(club({ activity: { bookingsBot: 0, dormant: false } }), NOW).reasons).toEqual([
      'El bot no tomó reservas en 30 días',
    ])
  })

  it('gives a brand-new club time before a quiet bot counts against it', () => {
    expect(clubHealth(club({ createdAt: daysAgo(5), activity: { bookingsBot: 0, dormant: false } }), NOW).status).toBe(
      'healthy',
    )
  })

  it('flags a club whose bot is paused for credits', () => {
    expect(clubHealth(club({ credits: { used: 2_000, limit: 2_000, paused: true } }), NOW)).toEqual({
      status: 'botPaused',
      reasons: ['Sin créditos: el bot está pausado (2000 de 2000 este mes)'],
    })
  })

  it('tells a trial taking bookings apart from one about to end', () => {
    expect(clubHealth(club({ subscription: trial(20) }), NOW).status).toBe('starting')
    expect(clubHealth(club({ subscription: trial(3) }), NOW)).toEqual({
      status: 'trialEnding',
      reasons: ['La prueba termina en 3 días'],
    })
  })

  it('puts the most urgent state first and keeps every reason', () => {
    const result = clubHealth(
      club({
        subscription: { subscriptionStatus: 'CANCELLED', severity: 'blocked', daysLeft: null },
        activity: { bookingsBot: 0, dormant: true },
      }),
      NOW,
    )
    expect(result.status).toBe('inactive')
    expect(result.reasons).toEqual([
      'Suscripción cancelada',
      'Nadie entra al panel hace más de 14 días',
      'El bot no tomó reservas en 30 días',
    ])
  })
})
