import { shiftDateKey, wallTimeToUtc } from './datetime'

/**
 * The club's fixed daily schedule (operating hours). Availability is "open by
 * default": every band on every court is bookable unless a Slot row marks it
 * BOOKED or BLOCKED. A booking materializes the Slot row on the fly — the same
 * model the admin panel uses (see `ReserveCellForm.ensureSlotId`).
 */
export interface ScheduleBand {
  start: string // "HH:MM"
  end: string // "HH:MM" ("00:00" closes at midnight of the next day)
}

export const SCHEDULE_BANDS: ScheduleBand[] = [
  { start: '09:00', end: '10:30' },
  { start: '10:30', end: '12:00' },
  { start: '12:00', end: '13:30' },
  { start: '13:30', end: '15:00' },
  { start: '15:00', end: '16:30' },
  { start: '16:30', end: '18:00' },
  { start: '18:00', end: '19:30' },
  { start: '19:30', end: '21:00' },
  { start: '21:00', end: '22:30' },
  { start: '22:30', end: '00:00' },
]

/** Finds a schedule band by its start time ("HH:MM"). */
export function findBand(start: string): ScheduleBand | undefined {
  return SCHEDULE_BANDS.find(b => b.start === start)
}

/** UTC start/end instants for a band on a given club-local day. */
export function bandDateTimes(dateKey: string, band: ScheduleBand): { startsAt: Date; endsAt: Date } {
  const startsAt = wallTimeToUtc(dateKey, band.start)
  const endsAt =
    band.end === '00:00' ? wallTimeToUtc(shiftDateKey(dateKey, 1), '00:00') : wallTimeToUtc(dateKey, band.end)
  return { startsAt, endsAt }
}
