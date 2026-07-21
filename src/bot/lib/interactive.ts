import { dayLabelFromKey, dayMonthFromKey, shiftDateKey, todayKey } from '../../availability/lib/datetime'
import { PART_OF_DAY_LABELS, PART_OF_DAY_PREFIX, partsWithBands } from './part-of-day'
import { BotState, Interactive, InteractiveButton, InteractiveRow, MY_BOOKING_PREFIX, SessionContext } from '../types'

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

/** The main actions — ids match what `onMenu` already expects. */
const MENU_BUTTONS: Interactive = {
  buttons: [
    { id: '1', title: '🎾 Reservar' },
    { id: '2', title: '🗓️ Mis turnos' },
  ],
}

/** Yes/No for the booking summary — ids feed `normalizeYesNo`. */
const CONFIRM_BOOKING_BUTTONS: Interactive = {
  buttons: [
    { id: 'si', title: '✅ Confirmar' },
    { id: 'no', title: '✖️ Mejor no' },
  ],
}

/** Yes/No on moving a booking — worded so a mis-tap doesn't move somebody's court. */
const CONFIRM_RESCHEDULE_BUTTONS: Interactive = {
  buttons: [
    { id: 'si', title: '🔄 Sí, movelo' },
    { id: 'no', title: '↩️ Dejalo igual' },
  ],
}

/**
 * The player's upcoming bookings — id = "turno:<bookingId>", resolved by the FSM.
 *
 * Two courts booked in the same band render the same "14/07 · 19:30" — routine for a group of
 * eight. The court is what tells them apart, so it joins the title as soon as the hour alone
 * stops being an answer to "which one?".
 */
function myBookingsInteractive(ctx: SessionContext): Interactive | undefined {
  const bookings = ctx.myBookings ?? []
  const seen = new Map<string, number>()
  for (const b of bookings) seen.set(b.short, (seen.get(b.short) ?? 0) + 1)

  return chooseInteractive(
    bookings.map(b => ({
      id: `${MY_BOOKING_PREFIX}${b.id}`,
      title: truncate((seen.get(b.short) ?? 0) > 1 ? `${b.short} · ${b.courtName}` : b.short, ROW_TITLE_MAX),
      description: b.pending ? `${b.courtName} · falta la seña` : b.courtName,
    })),
    'Ver mis turnos',
  )
}

/**
 * Picks buttons (≤3 short options) or a list (≤10) for a set of choices, or undefined when
 * it doesn't fit — then the plain text (which already lists them) is sent as-is.
 *
 * Buttons carry no description, so two options that render the same title are indistinguishable
 * to the player — and Meta rejects the whole message with "Duplicate button title" (400), which
 * means the bot answers with *silence*. A padel group booking two courts in the same band hits
 * this on their very first "mis turnos". When titles collide we fall through to the list, whose
 * rows do carry a description (the court) to tell them apart.
 */
function chooseInteractive(options: InteractiveRow[], listButton: string): Interactive | undefined {
  if (options.length === 0) return undefined

  const titlesAreUnique = new Set(options.map(o => o.title)).size === options.length

  if (options.length <= MAX_BUTTONS && titlesAreUnique && options.every(o => o.title.length <= BUTTON_TITLE_MAX)) {
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

/** How many days ahead the date picker offers. */
const DATE_PICKER_DAYS = 7

/**
 * The next few days as a one-tap list. Ids are "DD/MM", which `parseDateExpression` already
 * understands, so a tap costs nothing: no LLM call, no new FSM branch. Typing "el sábado"
 * still works — this just means most players never have to.
 */
function datesInteractive(): Interactive {
  const today = todayKey()
  const rows: InteractiveRow[] = []

  for (let i = 0; i < DATE_PICKER_DAYS; i++) {
    const key = shiftDateKey(today, i)
    const label = dayLabelFromKey(key) // "domingo 12/07"
    const title = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : label
    rows.push({
      id: dayMonthFromKey(key), // "12/07"
      title: truncate(title, ROW_TITLE_MAX),
      ...(i <= 1 ? { description: label } : {}),
    })
  }

  return { list: { button: 'Elegí un día', rows } }
}

function courtsInteractive(ctx: SessionContext): Interactive | undefined {
  const courts = ctx.courtOptions ?? []
  // id = court name → matchCourt resolves it; exact-match wins over substrings.
  const options = courts.map(c => ({ id: c.name, title: c.name }))
  // In the "free on several courts at this time" step, offer a one-tap "Cualquiera".
  if (ctx.selectedBandStart) options.push({ id: 'cualquiera', title: 'Cualquiera' })
  return chooseInteractive(options, 'Ver canchas')
}

function slotsInteractive(ctx: SessionContext): Interactive | undefined {
  const slots = ctx.slotOptions ?? []

  // More free bands than a WhatsApp list can hold (a club with 60-minute turns easily has 16):
  // offer the parts of the day instead, and list that part's hours on the next tap. Without
  // this the player gets no botonera at all and every reply falls through to the LLM.
  if (slots.length > MAX_ROWS) {
    const parts = partsWithBands(ctx.dayAvailability ?? [])
    if (parts.length > 1) {
      return {
        buttons: parts.map(p => ({ id: `${PART_OF_DAY_PREFIX}${p}`, title: PART_OF_DAY_LABELS[p] })),
      }
    }
  }

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

/** The botonera for the step the player will see next, or undefined to send plain text. */
export function buildInteractive(state: BotState, ctx: SessionContext): Interactive | undefined {
  switch (state) {
    case BotState.IDLE:
    case BotState.MENU:
      return MENU_BUTTONS
    case BotState.BOOK_DATE:
      return datesInteractive()
    case BotState.BOOK_COURT:
      return courtsInteractive(ctx)
    case BotState.BOOK_SLOT:
      return slotsInteractive(ctx)
    case BotState.BOOK_CONFIRM:
      return CONFIRM_BOOKING_BUTTONS
    case BotState.MY_BOOKINGS:
      return myBookingsInteractive(ctx)
    // A move reuses the booking flow's pickers — same ids, same parsing, no LLM.
    case BotState.RESCHEDULE_DATE:
      return datesInteractive()
    case BotState.RESCHEDULE_SLOT:
      return slotsInteractive(ctx)
    case BotState.RESCHEDULE_CONFIRM:
      return CONFIRM_RESCHEDULE_BUTTONS
    default:
      // BOOK_NAME, BOOK_DNI → free-text answers, no botonera.
      return undefined
  }
}
