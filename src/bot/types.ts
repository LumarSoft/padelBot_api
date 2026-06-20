export enum BotState {
  IDLE = 'IDLE',
  MENU = 'MENU',
  BOOK_DATE = 'BOOK_DATE',
  BOOK_NAME = 'BOOK_NAME',
  BOOK_COURT = 'BOOK_COURT',
  BOOK_SLOT = 'BOOK_SLOT',
  BOOK_CONFIRM = 'BOOK_CONFIRM',
  CANCEL_SELECT = 'CANCEL_SELECT',
  CANCEL_CONFIRM = 'CANCEL_CONFIRM',
}

export interface CourtOption {
  id: string
  name: string
}

export interface SlotOption {
  id: string
  label: string
  price: number
}

export interface BookingOption {
  id: string
  label: string
}

/** Mutable data accumulated across turns for the current flow. */
export interface SessionContext {
  /** Persisted across flows — user doesn't re-enter their name every time. */
  playerName?: string
  selectedDate?: string
  courtOptions?: CourtOption[]
  selectedCourtId?: string
  selectedCourtName?: string
  slotOptions?: SlotOption[]
  selectedSlotId?: string
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
