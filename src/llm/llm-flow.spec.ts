import { LlmService, validBookingDate } from './llm.service'
import { BotState, SessionContext } from '../bot/types'
import { NOT_UNDERSTOOD, TOO_MANY_MESSAGES } from '../bot/messages'

/**
 * The LLM must never cost the player their booking.
 *
 * Every answer used to come back with `state: MENU`. So a player standing on the confirmation
 * summary who asked "¿la cancha es techada?" got a correct answer — and silently lost the
 * booking they were one tap from confirming, because the FSM had been reset underneath them.
 * The same happened on an OpenAI error and on the rate limit.
 *
 * The rule these tests pin: the bot may SAY anything, but it only MOVES the player when it
 * actually resolved a booking step.
 */

/** A player parked on the booking summary, one "sí" away from a reservation. */
const atConfirm: SessionContext = {
  playerName: 'Martínez',
  selectedDate: '2026-07-18',
  selectedCourtId: 'c1',
  selectedCourtName: 'Cancha 1',
  selectedBandStart: '18:00',
  selectedSlotLabel: '18:00–19:30',
  selectedSlotPrice: 25000,
}

function makeService(): LlmService {
  // The OpenAI client refuses to construct without a key — and it SHOULD, in production.
  process.env.OPENAI_API_KEY ??= 'test-key'
  return new LlmService({} as never, {} as never)
}

/** Calls the private in-place helper the way every fallback path does. */
const inPlace = (service: LlmService, text: string, state: BotState, ctx: SessionContext) =>
  (
    service as unknown as {
      inPlace: (t: string, s: BotState, c: SessionContext) => { reply: string; prefix?: string; state: BotState }
    }
  ).inPlace(text, state, ctx)

describe('answering without moving the player', () => {
  it('keeps a player on the confirmation step and re-shows the summary', () => {
    const result = inPlace(makeService(), 'Sí, la Cancha 1 es techada 🎾', BotState.BOOK_CONFIRM, atConfirm)

    expect(result.state).toBe(BotState.BOOK_CONFIRM)
    // The answer survives…
    expect(result.prefix).toContain('techada')
    // …above the summary, so "sí" still has an unambiguous meaning.
    expect(result.reply).toContain('Resumen de tu reserva')
    expect(result.reply).toContain('Cancha 1')
  })

  it('holds the step when OpenAI fails instead of dumping the player at the menu', () => {
    const result = inPlace(makeService(), NOT_UNDERSTOOD, BotState.BOOK_CONFIRM, atConfirm)

    expect(result.state).toBe(BotState.BOOK_CONFIRM)
    expect(result.reply).toContain('Resumen de tu reserva')
  })

  it('holds the step when the player floods the bot (rate limit)', () => {
    const result = inPlace(makeService(), TOO_MANY_MESSAGES, BotState.BOOK_DATE, { playerName: 'Martínez' })

    expect(result.state).toBe(BotState.BOOK_DATE)
    expect(result.prefix).toBe(TOO_MANY_MESSAGES)
  })

  it('falls back to the menu only when the step cannot be rebuilt', () => {
    // A general question at the menu — there is no flow to protect.
    const result = inPlace(makeService(), 'Abrimos de 9 a 24 🎾', BotState.MENU, {})

    expect(result.state).toBe(BotState.MENU)
    expect(result.reply).toContain('Abrimos')
    expect(result.prefix).toBeUndefined()
  })

  it('falls back to the menu when the context is too thin to re-show the step', () => {
    // BOOK_CONFIRM with nothing selected (an expired session) can't be rebuilt.
    const result = inPlace(makeService(), 'Dale', BotState.BOOK_CONFIRM, {})

    expect(result.state).toBe(BotState.MENU)
  })
})

describe('validBookingDate', () => {
  const today = '2026-07-12'

  it('accepts today and the days ahead', () => {
    expect(validBookingDate('2026-07-12', today)).toBe('2026-07-12')
    expect(validBookingDate('2026-07-18', today)).toBe('2026-07-18')
  })

  it('rejects a date in the past — the club can never sell it', () => {
    expect(validBookingDate('2026-07-11', today)).toBeNull()
    expect(validBookingDate('2025-01-01', today)).toBeNull()
  })

  it('rejects a hallucinated calendar day instead of rendering "NaN/NaN"', () => {
    expect(validBookingDate('2026-13-45', today)).toBeNull()
    expect(validBookingDate('2026-02-31', today)).toBeNull()
    expect(validBookingDate('mañana', today)).toBeNull()
    expect(validBookingDate('18/07/2026', today)).toBeNull()
  })

  it('rejects a date past the booking horizon (a hallucinated year)', () => {
    expect(validBookingDate('2027-07-12', today)).toBeNull()
  })

  it('accepts a leap day the calendar really has', () => {
    expect(validBookingDate('2028-02-29', '2028-02-01')).toBe('2028-02-29')
    expect(validBookingDate('2027-02-29', '2027-02-01')).toBeNull()
  })
})
