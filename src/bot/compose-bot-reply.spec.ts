import {
  bookingConfirmedNoDeposit,
  composeBotReply,
  welcome,
  confirmBooking,
  dayAvailabilityList,
  courtsAtTimeList,
  noShowReviewRequested,
  rescheduleConfirm,
  rescheduleDone,
} from './messages'
import { BandOption, BotState, SessionContext } from './types'

/**
 * The body must never duplicate options that are already shown as buttons/rows, and menu
 * buttons must only appear on an actual menu (not on every message that ends on MENU state).
 */
describe('composeBotReply', () => {
  it('shows the menu button and a concise body (no enumerated list) on the menu', () => {
    const r = composeBotReply(BotState.MENU, {}, welcome('Mateo'))
    expect(r.interactive?.buttons?.map(b => b.id)).toEqual(['1', '2', '3'])
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

/**
 * "Sin seña": the bot's last word on a booking is the confirmation itself. It lands on the MENU
 * state like the payment message does, so it must go out as plain text — never buried under a
 * menu botonera — and it must not read like a payment request.
 */
describe('composeBotReply without a seña', () => {
  const booked: SessionContext = {
    playerName: 'Mateo',
    selectedDate: '2026-10-17',
    selectedCourtName: 'Cancha 2',
    selectedSlotLabel: '20:00 - 21:30',
    selectedSlotPrice: 2400000,
  }

  it('sends the confirmation as is, without menu buttons', () => {
    const text = bookingConfirmedNoDeposit(booked)
    const r = composeBotReply(BotState.MENU, {}, text)
    expect(r.interactive).toBeUndefined()
    expect(r.text).toBe(text)
  })

  it('confirms the booking without a single word about paying up front', () => {
    const text = bookingConfirmedNoDeposit(booked)
    expect(text).toContain('reserva confirmada')
    expect(text).toContain('17/10')
    expect(text).toContain('Cancha 2')
    expect(text).toContain('$24.000')
    expect(text).not.toMatch(/alias|transfer|seña|minutos/i)
  })

  it('leaves the price out when the court has none loaded', () => {
    expect(bookingConfirmedNoDeposit({ ...booked, selectedSlotPrice: 0 })).not.toContain('$')
  })

  it('sends the no-show hand-off as plain text too, naming the requested turno', () => {
    const text = noShowReviewRequested(booked)
    const r = composeBotReply(BotState.MENU, {}, text)
    expect(r.interactive).toBeUndefined()
    expect(text).toContain('20:00 - 21:30')
    expect(text).toContain('te responden por acá')
  })

  it('confirms a move with the yes/no buttons and no seña in the wording', () => {
    const text = rescheduleConfirm('sábado 17/10 · 18:00–19:30 · Cancha 1', booked, 0, false)
    const r = composeBotReply(BotState.RESCHEDULE_CONFIRM, booked, text)
    expect(r.text).toContain('Mismo precio. ¿Lo muevo?')
    expect(r.text).not.toContain('seña')
  })

  it('states the new price, not a credit "a favor", after moving a booking without seña', () => {
    expect(rescheduleDone(booked, -300000, false)).toContain('sale *$24.000* y se abona en el club')
    expect(rescheduleDone(booked, -300000, false)).not.toContain('a favor')
    // With a seña the old wording stays.
    expect(rescheduleDone(booked, -300000, true)).toContain('a favor')
  })
})
