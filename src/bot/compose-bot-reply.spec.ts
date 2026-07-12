import { composeBotReply, welcome, confirmBooking, dayAvailabilityList, courtsAtTimeList } from './messages'
import { BandOption, BotState, SessionContext } from './types'

/**
 * The body must never duplicate options that are already shown as buttons/rows, and menu
 * buttons must only appear on an actual menu (not on every message that ends on MENU state).
 */
describe('composeBotReply', () => {
  it('shows the menu button and a concise body (no enumerated list) on the menu', () => {
    const r = composeBotReply(BotState.MENU, {}, welcome('Mateo'))
    expect(r.interactive?.buttons?.map(b => b.id)).toEqual(['1', '2'])
    expect(r.text).toContain('Tocá una opción')
    expect(r.text).not.toContain('1️⃣')
    // the greeting prefix is preserved
    expect(r.text).toContain('Mateo')
  })

  it('does NOT attach menu buttons to a non-menu message that merely ends on MENU state', () => {
    const paymentText = '⏳ Reserva pre-confirmada — falta el pago. Transferí $1.250 al alias.'
    const r = composeBotReply(BotState.MENU, {}, paymentText)
    expect(r.interactive).toBeUndefined()
    expect(r.text).toBe(paymentText)
  })

  it('shows time-band buttons and a concise prompt for the day availability (no court step)', () => {
    const bands: BandOption[] = [
      { bandStart: '18:00', label: '18:00 - 19:30', courts: [{ id: 'a', name: 'Cancha 1', price: 1200000 }] },
      { bandStart: '19:30', label: '19:30 - 21:00', courts: [{ id: 'b', name: 'Cancha 2', price: 1000000 }] },
    ]
    const ctx: SessionContext = {
      selectedDate: '2026-06-27',
      dayAvailability: bands,
      slotOptions: bands.map(b => ({ bandStart: b.bandStart, label: b.label, price: b.courts[0].price })),
    }
    const full = dayAvailabilityList(bands, ctx.selectedDate!)
    const r = composeBotReply(BotState.BOOK_SLOT, ctx, full)
    // Buttons are the time bands (id = band start), not courts.
    expect(r.interactive?.buttons?.map(b => b.id)).toEqual(['18:00', '19:30'])
    // The grouped list is replaced by a concise prompt that mentions assigning a court.
    expect(r.text).not.toContain('*Cancha 1*')
    expect(r.text).toContain('horario')
  })

  it('offers court buttons (plus "Cualquiera") when a chosen time is free on several courts', () => {
    const bands: BandOption[] = [
      {
        bandStart: '18:00',
        label: '18:00 - 19:30',
        courts: [
          { id: 'a', name: 'Cancha 1', price: 1200000 },
          { id: 'b', name: 'Cancha 2', price: 1000000 },
        ],
      },
    ]
    const ctx: SessionContext = {
      selectedDate: '2026-06-27',
      selectedBandStart: '18:00',
      selectedSlotLabel: '18:00 - 19:30',
      dayAvailability: bands,
      courtOptions: [
        { id: 'a', name: 'Cancha 1' },
        { id: 'b', name: 'Cancha 2' },
      ],
    }
    const full = courtsAtTimeList(
      bands[0].courts.map(c => ({ name: c.name, price: c.price })),
      '18:00 - 19:30',
      ctx.selectedDate!,
    )
    const r = composeBotReply(BotState.BOOK_COURT, ctx, full)
    expect(r.interactive?.buttons?.map(b => b.id)).toEqual(['Cancha 1', 'Cancha 2', 'cualquiera'])
    expect(r.text).not.toContain('• Cancha 1')
  })

  it('keeps the booking summary text intact and adds yes/no buttons on confirm', () => {
    const ctx: SessionContext = {
      selectedDate: '2026-06-27',
      selectedCourtName: 'Cancha 1',
      selectedSlotLabel: '18:00 - 19:30',
      selectedSlotPrice: 500000,
      playerName: 'Mateo',
    }
    const summary = confirmBooking(ctx)
    const r = composeBotReply(BotState.BOOK_CONFIRM, ctx, summary)
    expect(r.interactive?.buttons?.map(b => b.id)).toEqual(['si', 'no'])
    expect(r.text).toBe(summary) // summary is not an option list — keep it
  })
})
