import { BotState, SessionContext } from '../types'
import {
  ASK_DATE,
  ASK_DNI,
  ASK_NAME,
  askRescheduleDate,
  confirmBooking,
  courtsAtTimeList,
  dayAvailabilityList,
  myBookingsList,
  rescheduleConfirm,
  slotsList,
} from '../messages'

/**
 * Rebuilds the prompt of the step the player is standing on, from the session context alone.
 *
 * This is what lets the bot answer a question ("¿la cancha es techada?") without destroying
 * the booking the player was in the middle of: we reply, re-show the step, and stay put.
 * Returns null when the step has no prompt to rebuild (the menu, or a context too thin to
 * render) — the caller then falls back to the menu.
 */
export function stepPrompt(state: BotState, ctx: SessionContext): string | null {
  switch (state) {
    case BotState.BOOK_DATE:
      return ASK_DATE

    case BotState.BOOK_NAME:
      return ASK_NAME

    case BotState.BOOK_DNI:
      return ASK_DNI

    case BotState.BOOK_COURT: {
      // The "free on several courts at this time" step → re-show that list.
      if (!ctx.selectedBandStart || !ctx.selectedDate) return null
      const band = ctx.dayAvailability?.find(b => b.bandStart === ctx.selectedBandStart)
      if (!band) return null
      return courtsAtTimeList(
        band.courts.map(c => ({ name: c.name, price: c.price })),
        band.label,
        ctx.selectedDate,
      )
    }

    case BotState.RESCHEDULE_DATE:
      return ctx.rescheduleFromLabel ? askRescheduleDate(ctx.rescheduleFromLabel) : ASK_DATE

    case BotState.RESCHEDULE_SLOT:
    case BotState.BOOK_SLOT:
      if (!ctx.selectedDate) return null
      // Explicit single court → its slot list; otherwise the day's availability.
      if (ctx.selectedCourtName && ctx.slotOptions?.length) {
        return slotsList(ctx.slotOptions, ctx.selectedCourtName, ctx.selectedDate)
      }
      return ctx.dayAvailability?.length ? dayAvailabilityList(ctx.dayAvailability, ctx.selectedDate) : null

    case BotState.BOOK_CONFIRM:
      // Re-show the summary so "sí" still has an unambiguous meaning.
      return ctx.selectedDate && ctx.selectedCourtName && ctx.selectedSlotLabel ? confirmBooking(ctx) : null

    case BotState.MY_BOOKINGS:
      return ctx.myBookings?.length ? myBookingsList(ctx.myBookings) : null

    case BotState.RESCHEDULE_CONFIRM:
      // Re-shown without a DB read: the price difference is already in the context.
      return ctx.rescheduleFromLabel && ctx.selectedSlotLabel
        ? rescheduleConfirm(
            ctx.rescheduleFromLabel,
            ctx,
            (ctx.selectedSlotPrice ?? 0) - (ctx.rescheduleFromPriceCents ?? 0),
          )
        : null

    default:
      return null
  }
}
