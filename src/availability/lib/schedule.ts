import { shiftDateKey, wallTimeToUtc } from './datetime'

export interface ScheduleBand {
  start: string // "HH:MM"
  end: string // "HH:MM" ("00:00" = midnight of the next day)
}

export const SLOT_DURATION_MINUTES = 90

/**
 * Generates the daily schedule bands for a court from its openTime/closeTime.
 * closeTime "00:00" means midnight (end of the calendar day).
 */
export function generateBands(openTime: string, closeTime: string): ScheduleBand[] {
  const [oh, om] = openTime.split(':').map(Number)
  const [ch, cm] = closeTime.split(':').map(Number)

  let cursor = oh * 60 + om
  const endOfDay = ch === 0 && cm === 0 ? 24 * 60 : ch * 60 + cm

  const bands: ScheduleBand[] = []
  while (cursor + SLOT_DURATION_MINUTES <= endOfDay) {
    const next = cursor + SLOT_DURATION_MINUTES
    const sh = Math.floor(cursor / 60)
    const sm = cursor % 60
    const eh = Math.floor(next / 60) % 24
    const em = next % 60
    bands.push({
      start: `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`,
      end: next >= 24 * 60 ? '00:00' : `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`,
    })
    cursor = next
  }
  return bands
}

/** Finds a band by its start time within a court's generated schedule. */
export function findBandInSchedule(bands: ScheduleBand[], start: string): ScheduleBand | undefined {
  return bands.find(b => b.start === start)
}

/** UTC start/end instants for a band on a given club-local day. */
export function bandDateTimes(dateKey: string, band: ScheduleBand): { startsAt: Date; endsAt: Date } {
  const startsAt = wallTimeToUtc(dateKey, band.start)
  const endsAt =
    band.end === '00:00' ? wallTimeToUtc(shiftDateKey(dateKey, 1), '00:00') : wallTimeToUtc(dateKey, band.end)
  return { startsAt, endsAt }
}
