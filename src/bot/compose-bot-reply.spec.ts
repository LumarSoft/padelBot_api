import { composeBotReply, welcome, confirmBooking, courtsList } from './messages'
import { BotState, SessionContext } from './types'

/**
 * The body must never duplicate options that are already shown as buttons/rows, and menu
 * buttons must only appear on an actual menu (not on every message that ends on MENU state).
 */
describe('composeBotReply', () => {
  it('shows menu buttons and a concise body (no enumerated 1/2/3 list) on the menu', () => {
    const r = composeBotReply(BotState.MENU, {}, welcome('Mateo'))
    expect(r.interactive?.buttons?.map(b => b.id)).toEqual(['1', '2', '3'])
    expect(r.text).toContain('Tocá una opción')
    expect(r.text).not.toContain('1️⃣')
    expect(r.text).not.toContain('Ver o cancelar mis reservas')
    // the greeting prefix is preserved
    expect(r.text).toContain('Mateo')
  })

  it('does NOT attach menu buttons to a non-menu message that merely ends on MENU state', () => {
    const paymentText = '⏳ Reserva pre-confirmada — falta el pago. Transferí $1.250 al alias.'
    const r = composeBotReply(BotState.MENU, {}, paymentText)
    expect(r.interactive).toBeUndefined()
    expect(r.text).toBe(paymentText)
  })

  it('replaces the enumerated court list with a concise prompt when buttons are shown', () => {
    const ctx: SessionContext = {
      selectedDate: '2026-06-27',
      courtOptions: [
        { id: 'a', name: 'Cancha 1' },
        { id: 'b', name: 'Cancha 2' },
      ],
    }
    const full = courtsList(ctx.courtOptions!, ctx.selectedDate!)
    const r = composeBotReply(BotState.BOOK_COURT, ctx, full)
    expect(r.interactive?.buttons?.map(b => b.id)).toEqual(['Cancha 1', 'Cancha 2'])
    expect(r.text).not.toContain('• Cancha 1')
    expect(r.text).toContain('canchas con lugar')
  })

  it('keeps the full court list when there are too many courts for a botonera', () => {
    const courtOptions = Array.from({ length: 11 }, (_, i) => ({ id: String(i), name: `Cancha ${i}` }))
    const ctx: SessionContext = { selectedDate: '2026-06-27', courtOptions }
    const full = courtsList(courtOptions, ctx.selectedDate!)
    const r = composeBotReply(BotState.BOOK_COURT, ctx, full)
    expect(r.interactive).toBeUndefined()
    expect(r.text).toBe(full) // full enumerated list preserved
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
