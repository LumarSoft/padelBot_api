import { formatWeeklySummary, WeeklySummaryData } from './ops-weekly-summary.service'

const week = (over: Partial<WeeklySummaryData> = {}): WeeklySummaryData => ({
  from: '2026-10-05',
  to: '2026-10-11',
  leads: { new: 4, channels: [{ label: 'Instagram', count: 3 }], contacted: 3, waiting: 1, dueToday: 2 },
  signupStarted: 40,
  clubs: {
    paying: 3,
    trial: 2,
    mrrCents: 23_999_700,
    previousMrrCents: 18_999_800,
    previousMonth: '2026-09',
    created: ['Padel Norte'],
    paused: ['Club Sur'],
    atRisk: [],
    trialEnding: ['Club Este'],
  },
  bookings: { bot: 120, panel: 40 },
  ...over,
})

describe('the Monday summary', () => {
  it('tells the week in a few lines', () => {
    const text = formatWeeklySummary(week())

    expect(text).toContain('5 al 11 de octubre')
    expect(text).toContain('*Solicitudes:* 4 nuevas (Instagram 3) · 3 contactadas')
    expect(text).toContain('1 sin contactar hace más de un día')
    expect(text).toContain('2 para llamar hoy')
    expect(text).toContain('40 lo empezaron y 4 lo enviaron (10%)')
    expect(text).toContain('ingreso recurrente $239.997 (+$49.999 vs. septiembre)')
    expect(text).toContain('*Altas:* Padel Norte')
    expect(text).toContain('⏸️ bot pausado: Club Sur')
    expect(text).toContain('⏳ prueba por vencer: Club Este')
    expect(text).toContain('120 por el bot y 40 por el panel (75% bot)')
  })

  it('says when nothing needs us, and leaves out empty lines', () => {
    const text = formatWeeklySummary(
      week({
        signupStarted: 0,
        bookings: { bot: 0, panel: 0 },
        clubs: { ...week().clubs, created: [], paused: [], trialEnding: [], previousMrrCents: null },
      }),
    )

    expect(text).toContain('*Para atender:* nada urgente.')
    expect(text).not.toContain('*Registro:*')
    expect(text).not.toContain('*Altas:*')
    expect(text).not.toContain('*Reservas:*')
    expect(text).not.toContain(' vs. ')
  })

  it('names both months for a week that crosses one', () => {
    expect(formatWeeklySummary(week({ from: '2026-09-28', to: '2026-10-04' }))).toContain(
      '28 de septiembre al 4 de octubre',
    )
  })
})
