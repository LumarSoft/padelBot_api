import { BotState, Interactive, InteractiveButton, InteractiveRow, SessionContext } from '../types'

// Builds the WhatsApp botonera that fits the step the player is on, derived purely from the
// resulting FSM state + context. Each option's `id` is the exact text the FSM already
// accepts, so a tap is equivalent to typing it — this guides the player (intuitive) and
// avoids LLM calls on the common path. When the options don't fit WhatsApp's limits we
// return undefined and the caller just sends the plain text (which already lists them).

/** WhatsApp interactive limits. */
const MAX_BUTTONS = 3
const MAX_ROWS = 10
const BUTTON_TITLE_MAX = 20
const ROW_TITLE_MAX = 24
const ROW_DESC_MAX = 72

const truncate = (s: string, max: number): string => (s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…')

/** The three main actions — ids match what `onMenu` / advisor handling already expect. */
const MENU_BUTTONS: Interactive = {
  buttons: [
    { id: '1', title: 'Reservar' },
    { id: '2', title: 'Mis reservas' },
    { id: '3', title: 'Hablar con asesor' },
  ],
}

/** Yes/No for the booking summary — ids feed `normalizeYesNo`. */
const CONFIRM_BOOKING_BUTTONS: Interactive = {
  buttons: [
    { id: 'si', title: '✅ Confirmar' },
    { id: 'no', title: '✖️ Mejor no' },
  ],
}

/** Yes/No for a cancellation — "Sí" means cancel; ids still feed `normalizeYesNo`. */
const CONFIRM_CANCEL_BUTTONS: Interactive = {
  buttons: [
    { id: 'si', title: 'Sí, cancelar' },
    { id: 'no', title: 'No, dejarla' },
  ],
}

/**
 * Picks buttons (≤3 short options) or a list (≤10) for a set of choices, or undefined when
 * it doesn't fit — then the plain text (which already lists them) is sent as-is.
 */
function chooseInteractive(options: InteractiveRow[], listButton: string): Interactive | undefined {
  if (options.length === 0) return undefined

  if (options.length <= MAX_BUTTONS && options.every(o => o.title.length <= BUTTON_TITLE_MAX)) {
    const buttons: InteractiveButton[] = options.map(o => ({ id: o.id, title: o.title }))
    return { buttons }
  }

  if (options.length <= MAX_ROWS) {
    const rows: InteractiveRow[] = options.map(o => ({
      id: o.id,
      title: truncate(o.title, ROW_TITLE_MAX),
      ...(o.description ? { description: truncate(o.description, ROW_DESC_MAX) } : {}),
    }))
    return { list: { button: listButton, rows } }
  }

  return undefined
}

function courtsInteractive(ctx: SessionContext): Interactive | undefined {
  const courts = ctx.courtOptions ?? []
  // id = court name → matchCourt resolves it; exact-match wins over substrings.
  return chooseInteractive(
    courts.map(c => ({ id: c.name, title: c.name })),
    'Ver canchas',
  )
}

function slotsInteractive(ctx: SessionContext): Interactive | undefined {
  const slots = ctx.slotOptions ?? []
  // id = band start ("18:00") → matchSlot resolves it by the hour.
  return chooseInteractive(
    slots.map(s => ({
      id: s.bandStart,
      title: s.label,
      description: s.price > 0 ? `$${(s.price / 100).toLocaleString('es-AR')}` : undefined,
    })),
    'Ver horarios',
  )
}

function cancelInteractive(ctx: SessionContext): Interactive | undefined {
  const options = ctx.bookingOptions ?? []
  if (options.length === 0 || options.length > MAX_ROWS - 1) return undefined
  // id = 1-based index (+ "0" to go back) → onCancelSelect handles both.
  const rows: InteractiveRow[] = options.map((o, i) => ({ id: String(i + 1), title: truncate(o.label, ROW_TITLE_MAX) }))
  rows.push({ id: '0', title: 'Volver' })
  return { list: { button: 'Elegir reserva', rows } }
}

/** The botonera for the step the player will see next, or undefined to send plain text. */
export function buildInteractive(state: BotState, ctx: SessionContext): Interactive | undefined {
  switch (state) {
    case BotState.IDLE:
    case BotState.MENU:
      return MENU_BUTTONS
    case BotState.BOOK_DATE:
      // No buttons here on purpose — the player types a date / "hoy" / "mañana" / "el sábado".
      return undefined
    case BotState.BOOK_COURT:
      return courtsInteractive(ctx)
    case BotState.BOOK_SLOT:
      return slotsInteractive(ctx)
    case BotState.BOOK_CONFIRM:
      return CONFIRM_BOOKING_BUTTONS
    case BotState.CANCEL_SELECT:
      return cancelInteractive(ctx)
    case BotState.CANCEL_CONFIRM:
      return CONFIRM_CANCEL_BUTTONS
    default:
      // BOOK_NAME, BOOK_DNI → free-text answers, no botonera.
      return undefined
  }
}
