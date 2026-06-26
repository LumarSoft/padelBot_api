export enum BotState {
  IDLE = 'IDLE',
  MENU = 'MENU',
  BOOK_DATE = 'BOOK_DATE',
  BOOK_NAME = 'BOOK_NAME',
  BOOK_COURT = 'BOOK_COURT',
  BOOK_SLOT = 'BOOK_SLOT',
  BOOK_CONFIRM = 'BOOK_CONFIRM',
  BOOK_DNI = 'BOOK_DNI',
  CANCEL_SELECT = 'CANCEL_SELECT',
  CANCEL_CONFIRM = 'CANCEL_CONFIRM',
}

export interface CourtOption {
  id: string
  name: string
}

export interface SlotOption {
  /** "HH:MM" start of the schedule band — identifies the slot to book/materialize. */
  bandStart: string
  label: string
  price: number
  /** Present only when a real Slot row already exists (AVAILABLE) for this band. */
  slotId?: string
}

export interface BookingOption {
  id: string
  label: string
}

export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Mutable data accumulated across turns for the current flow. */
export interface SessionContext {
  /** Persisted across flows — user doesn't re-enter their name every time. */
  playerName?: string
  /** DNI captured for payer validation (digits), when the club requires it. Persisted across flows. */
  playerDni?: string
  /** Recent conversation turns sent to the LLM for context. */
  history?: HistoryMessage[]
  selectedDate?: string
  courtOptions?: CourtOption[]
  selectedCourtId?: string
  selectedCourtName?: string
  slotOptions?: SlotOption[]
  selectedSlotId?: string
  selectedBandStart?: string
  selectedSlotLabel?: string
  selectedSlotPrice?: number
  bookingOptions?: BookingOption[]
  selectedBookingId?: string
  selectedBookingLabel?: string
}

export interface HandlerResult {
  reply: string
  state: BotState
  ctx: SessionContext
}

// ── WhatsApp interactive (botoneras) ─────────────────────────────────────────
// A quick-reply button or a list row. Its `id` is the exact text the FSM already
// accepts (e.g. "1", a court name, "18:00", "si"), so tapping it is equivalent to
// typing that input — no extra FSM logic, and it avoids paying for an LLM call.

export interface InteractiveButton {
  /** Fed back to the FSM as the message body when tapped. */
  id: string
  /** Visible label (WhatsApp limit: 20 chars). */
  title: string
}

export interface InteractiveRow {
  id: string
  /** WhatsApp limit: 24 chars. */
  title: string
  /** Optional secondary line (WhatsApp limit: 72 chars). */
  description?: string
}

export interface InteractiveList {
  /** Label of the button that opens the list (WhatsApp limit: 20 chars). */
  button: string
  rows: InteractiveRow[]
}

/** Either up to 3 quick-reply buttons, or a single-select list. Never both. */
export interface Interactive {
  buttons?: InteractiveButton[]
  list?: InteractiveList
}

/** What BotService returns to the transport layer: the text plus optional botonera. */
export interface BotReply {
  text: string
  interactive?: Interactive
}
