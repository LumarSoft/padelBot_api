import { shiftDateKey, toDateKey, wallTimeToUtc } from '../../availability/lib/datetime'
import { bandDateTimes, bandsForDate, CourtSchedule, isValidHHMM } from '../../availability/lib/schedule'

/** A session as stored: club-local day and wall-clock edges. */
export interface SessionTimes {
  dateKey: string
  startTime: string
  endTime: string
}

export interface TimeWindow {
  startsAt: Date
  endsAt: Date
}

/** The absolute window of a session. An end at or before the start falls on the next day. */
export function sessionWindow(session: SessionTimes): TimeWindow {
  if (!isValidHHMM(session.startTime) || !isValidHHMM(session.endTime)) {
    throw new Error('Los horarios tienen que tener el formato HH:MM')
  }
  if (session.startTime === session.endTime) {
    throw new Error('La hora de inicio y la de fin no pueden ser iguales')
  }
  const endDay = session.endTime <= session.startTime ? shiftDateKey(session.dateKey, 1) : session.dateKey
  return {
    startsAt: wallTimeToUtc(session.dateKey, session.startTime),
    endsAt: wallTimeToUtc(endDay, session.endTime),
  }
}

/**
 * The bands of a court's grid that overlap a window, i.e. the turnos the event takes away from
 * the players. Looks at the grids of the day before and after too: a late band of the previous
 * day can run past midnight into the window, and a window that ends past midnight reaches the
 * next day's early bands.
 */
export function bandsOverlapping(court: CourtSchedule, window: TimeWindow): TimeWindow[] {
  const day = toDateKey(window.startsAt)
  const byStart = new Map<number, TimeWindow>()
  for (const dateKey of [shiftDateKey(day, -1), day, shiftDateKey(day, 1)]) {
    for (const band of bandsForDate(court, dateKey)) {
      const times = bandDateTimes(dateKey, band)
      if (times.startsAt < window.endsAt && times.endsAt > window.startsAt) {
        byStart.set(times.startsAt.getTime(), times)
      }
    }
  }
  return [...byStart.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
}
