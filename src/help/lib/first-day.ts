import { DeskAction } from 'generated/prisma/client'

/**
 * "Tu primer día": the five things a new receptionist does every day, in the order the panel
 * teaches them. Each one is ticked from what THAT user really did, never from a "ya lo leí":
 *
 *   booking     → a Booking with bookedByUserId = the user (already in the data)
 *   consumption → UserFirstAction CONSUMPTION (loaded consumos onto a turno)
 *   deskPayment → UserFirstAction DESK_PAYMENT (charged a player at the desk)
 *   deposit     → UserFirstAction DEPOSIT_CONFIRMATION (confirmed a pending seña by hand)
 *   reschedule  → UserFirstAction RESCHEDULE (moved a turno to another time)
 *
 * "Ver los turnos de hoy" is not a task on purpose: the Agenda already opens on today and
 * looking leaves no trace — it lives in the "?" help, with its own "Mostrame".
 */
export const FIRST_DAY_TASK_IDS = ['booking', 'consumption', 'deskPayment', 'deposit', 'reschedule'] as const

export type FirstDayTaskId = (typeof FIRST_DAY_TASK_IDS)[number]

/** The logged desk action that ticks each task (booking is derived from the bookings themselves). */
export const DESK_ACTION_BY_TASK: Record<Exclude<FirstDayTaskId, 'booking'>, DeskAction> = {
  consumption: DeskAction.CONSUMPTION,
  deskPayment: DeskAction.DESK_PAYMENT,
  deposit: DeskAction.DEPOSIT_CONFIRMATION,
  reschedule: DeskAction.RESCHEDULE,
}

/** Which tasks are done, given whether the user ever booked and the desk actions they logged. */
export function doneFirstDayTasks(hasBooked: boolean, actions: DeskAction[]): FirstDayTaskId[] {
  const logged = new Set(actions)
  return FIRST_DAY_TASK_IDS.filter(id => (id === 'booking' ? hasBooked : logged.has(DESK_ACTION_BY_TASK[id])))
}
