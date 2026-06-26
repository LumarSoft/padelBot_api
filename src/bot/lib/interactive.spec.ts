import { buildInteractive } from './interactive'
import { BotState, SessionContext } from '../types'

/**
 * The botonera builder must (a) emit ids the FSM already accepts, and (b) respect WhatsApp's
 * limits — falling back to undefined (plain text) when options don't fit.
 */
describe('buildInteractive', () => {
  const ctx = (over: Partial<SessionContext> = {}): SessionContext => ({ ...over })

  it('offers the 3 menu actions with ids 1/2/3 on the menu', () => {
    const i = buildInteractive(BotState.MENU, ctx())
    expect(i?.buttons?.map(b => b.id)).toEqual(['1', '2', '3'])
  })

  it('offers yes/no buttons (ids si/no) on the booking summary', () => {
    expect(buildInteractive(BotState.BOOK_CONFIRM, ctx())?.buttons?.map(b => b.id)).toEqual(['si', 'no'])
  })

  it('offers yes/no buttons (ids si/no) on the cancel confirmation', () => {
    expect(buildInteractive(BotState.CANCEL_CONFIRM, ctx())?.buttons?.map(b => b.id)).toEqual(['si', 'no'])
  })

  it('uses buttons for ≤3 courts, with the court name as id', () => {
    const i = buildInteractive(BotState.BOOK_COURT, ctx({ courtOptions: [{ id: 'a', name: 'Cancha 1' }] }))
    expect(i?.buttons).toEqual([{ id: 'Cancha 1', title: 'Cancha 1' }])
  })

  it('uses a list for >3 courts and keeps the full name as id', () => {
    const courtOptions = ['1', '2', '3', '4', '5'].map(n => ({ id: n, name: `Cancha ${n}` }))
    const i = buildInteractive(BotState.BOOK_COURT, ctx({ courtOptions }))
    expect(i?.buttons).toBeUndefined()
    expect(i?.list?.rows.map(r => r.id)).toEqual(['Cancha 1', 'Cancha 2', 'Cancha 3', 'Cancha 4', 'Cancha 5'])
  })

  it('truncates a long court name in the list title but keeps the full id', () => {
    const courtOptions = ['1', '2', '3', '4'].map(n => ({ id: n, name: `Cancha ${n}` }))
    courtOptions[0].name = 'Cancha Panorámica Climatizada Premium Norte'
    const row = buildInteractive(BotState.BOOK_COURT, ctx({ courtOptions }))?.list?.rows[0]
    expect(row?.id).toBe('Cancha Panorámica Climatizada Premium Norte')
    expect(row?.title.length).toBeLessThanOrEqual(24)
  })

  it('falls back to plain text (undefined) when there are more than 10 courts', () => {
    const courtOptions = Array.from({ length: 11 }, (_, i) => ({ id: String(i), name: `Cancha ${i}` }))
    expect(buildInteractive(BotState.BOOK_COURT, ctx({ courtOptions }))).toBeUndefined()
  })

  it('uses the band start as the slot id so matchSlot resolves it', () => {
    const slotOptions = ['09:00', '10:30', '12:00', '13:30'].map(bandStart => ({
      bandStart,
      label: `${bandStart} - x`,
      price: 500000,
    }))
    const i = buildInteractive(BotState.BOOK_SLOT, ctx({ slotOptions }))
    expect(i?.list?.rows.map(r => r.id)).toEqual(['09:00', '10:30', '12:00', '13:30'])
  })

  it('numbers cancel options and appends a Volver row (id 0)', () => {
    const bookingOptions = [
      { id: 'x', label: '25/06 · Cancha 1 · 18:00 - 19:30' },
      { id: 'y', label: '26/06 · Cancha 2 · 20:00 - 21:30' },
    ]
    const rows = buildInteractive(BotState.CANCEL_SELECT, ctx({ bookingOptions }))?.list?.rows
    expect(rows?.map(r => r.id)).toEqual(['1', '2', '0'])
    expect(rows?.[2].title).toBe('Volver')
  })

  it('gives no botonera on free-text steps (name, dni)', () => {
    expect(buildInteractive(BotState.BOOK_NAME, ctx())).toBeUndefined()
    expect(buildInteractive(BotState.BOOK_DNI, ctx())).toBeUndefined()
  })

  it('shows no botonera on the date step (the player types the date freely)', () => {
    expect(buildInteractive(BotState.BOOK_DATE, ctx())).toBeUndefined()
  })
})
