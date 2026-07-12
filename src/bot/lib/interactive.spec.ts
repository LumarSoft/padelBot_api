import { buildInteractive } from './interactive'
import { BotState, SessionContext } from '../types'

/**
 * The botonera builder must (a) emit ids the FSM already accepts, and (b) respect WhatsApp's
 * limits — falling back to undefined (plain text) when options don't fit.
 */
describe('buildInteractive', () => {
  const ctx = (over: Partial<SessionContext> = {}): SessionContext => ({ ...over })

  it('offers booking and "mis turnos" on the menu, with the ids onMenu accepts', () => {
    const i = buildInteractive(BotState.MENU, ctx())
    expect(i?.buttons?.map(b => b.id)).toEqual(['1', '2'])
  })

  it('lists the player’s bookings with ids the FSM resolves, court in the description', () => {
    const myBookings = [
      {
        id: 'b1',
        label: 'sábado 18/07 · 18:00–19:30 · Cancha 1',
        short: '18/07 · 18:00',
        courtName: 'Cancha 1',
        pending: false,
      },
      {
        id: 'b2',
        label: 'domingo 19/07 · 20:00–21:30 · Cancha 2',
        short: '19/07 · 20:00',
        courtName: 'Cancha 2',
        pending: true,
      },
    ]
    const i = buildInteractive(BotState.MY_BOOKINGS, ctx({ myBookings }))
    // Two options → buttons; the id carries the booking so nothing is guessed from the text.
    expect(i?.buttons?.map(b => b.id)).toEqual(['turno:b1', 'turno:b2'])
  })

  it('asks for an explicit yes/no before moving a booking', () => {
    expect(buildInteractive(BotState.RESCHEDULE_CONFIRM, ctx())?.buttons?.map(b => b.id)).toEqual(['si', 'no'])
  })

  it('reuses the date and hour pickers when moving a booking', () => {
    // Same ids as the booking flow → same deterministic parsing, no extra LLM calls.
    expect(buildInteractive(BotState.RESCHEDULE_DATE, ctx())?.list?.rows[0].title).toBe('Hoy')

    const slotOptions = ['18:00', '19:30'].map(bandStart => ({ bandStart, label: bandStart, price: 20000 }))
    expect(buildInteractive(BotState.RESCHEDULE_SLOT, ctx({ slotOptions }))?.buttons?.map(b => b.id)).toEqual([
      '18:00',
      '19:30',
    ])
  })

  it('offers yes/no buttons (ids si/no) on the booking summary', () => {
    expect(buildInteractive(BotState.BOOK_CONFIRM, ctx())?.buttons?.map(b => b.id)).toEqual(['si', 'no'])
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

  it('gives no botonera on free-text steps (name, dni)', () => {
    expect(buildInteractive(BotState.BOOK_NAME, ctx())).toBeUndefined()
    expect(buildInteractive(BotState.BOOK_DNI, ctx())).toBeUndefined()
  })

  it('offers the next days on the date step, with ids the date parser understands', () => {
    // The date step is the most travelled fork in the bot: "hoy" / "mañana" / "el sábado"
    // used to be an OpenAI call each. Every id here is a "DD/MM" the FSM parses for free.
    const rows = buildInteractive(BotState.BOOK_DATE, ctx())?.list?.rows ?? []

    expect(rows).toHaveLength(7)
    expect(rows[0].title).toBe('Hoy')
    expect(rows[1].title).toBe('Mañana')
    for (const row of rows) {
      expect(row.id).toMatch(/^\d{2}\/\d{2}$/)
      expect(row.title.length).toBeLessThanOrEqual(24)
    }
  })

  describe('when the free bands do not fit a WhatsApp list', () => {
    // A club with 60-minute turns open 08:00–24:00 has 16 free bands. This used to produce NO
    // botonera at all, dropping the player back to free text (and an LLM call) every turn.
    const manyBands = Array.from({ length: 16 }, (_, i) => {
      const bandStart = `${String(8 + i).padStart(2, '0')}:00`
      return { bandStart, label: `${bandStart}–x`, courts: [{ id: 'c1', name: 'Cancha 1', price: 20000 }] }
    })
    const busyDay = () =>
      ctx({
        dayAvailability: manyBands,
        slotOptions: manyBands.map(b => ({ bandStart: b.bandStart, label: b.label, price: 20000 })),
      })

    it('offers the parts of the day instead of giving up', () => {
      const i = buildInteractive(BotState.BOOK_SLOT, busyDay())
      expect(i?.buttons?.map(b => b.id)).toEqual(['franja:manana', 'franja:tarde', 'franja:noche'])
    })

    it('lists the hours normally once a part is chosen', () => {
      const afternoon = manyBands.filter(b => b.bandStart >= '12:00' && b.bandStart < '19:00')
      const i = buildInteractive(
        BotState.BOOK_SLOT,
        ctx({
          dayAvailability: manyBands,
          slotOptions: afternoon.map(b => ({ bandStart: b.bandStart, label: b.label, price: 20000 })),
        }),
      )
      expect(i?.list?.rows.map(r => r.id)).toEqual(['12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'])
    })
  })
})
