import { shiftDateKey, wallTimeToUtc, weekdayOfKey } from './datetime'

export interface ScheduleBand {
  start: string // "HH:MM" wall-clock
  end: string // "HH:MM" wall-clock
  /** Days past the grid's dateKey where the band starts (1 = past midnight). */
  startOffset: number
  /** Days past the grid's dateKey where the band ends. */
  endOffset: number
}

export const DEFAULT_SLOT_DURATION_MINUTES = 90

/** Opening hours for one day. `close` ≤ `open` means the court closes past midnight. */
export interface DayHours {
  open: string // "HH:MM"
  close: string // "HH:MM"
}

/**
 * Per-weekday overrides keyed "0" (Sunday) … "6" (Saturday). A missing key falls
 * back to the court's default openTime/closeTime; an explicit null closes that day.
 */
export type WeeklyHours = Partial<Record<'0' | '1' | '2' | '3' | '4' | '5' | '6', DayHours | null>>

/** The schedule-relevant Court columns; matches `courtScheduleSelect`. */
export interface CourtSchedule {
  openTime: string
  closeTime: string
  slotDurationMinutes: number
  /** Prisma Json column — validated shape is WeeklyHours. */
  weeklyHours?: unknown
}

/** Prisma `select` fragment for everything band generation needs from a Court. */
export const courtScheduleSelect = {
  openTime: true,
  closeTime: true,
  slotDurationMinutes: true,
  weeklyHours: true,
} as const

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function isValidHHMM(value: unknown): value is string {
  return typeof value === 'string' && HHMM_RE.test(value)
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function formatMinutes(totalMinutes: number): string {
  const inDay = ((totalMinutes % 1440) + 1440) % 1440
  return `${String(Math.floor(inDay / 60)).padStart(2, '0')}:${String(inDay % 60).padStart(2, '0')}`
}

/**
 * Validates a raw `weeklyHours` JSON value (e.g. from the DB or a DTO) and returns
 * it typed, or throws a plain Error describing the problem (callers map it to a
 * BadRequestException at the edge).
 */
export function parseWeeklyHours(value: unknown): WeeklyHours | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('weeklyHours debe ser un objeto {"0".."6": {open, close} | null}')
  }
  const result: WeeklyHours = {}
  for (const [key, day] of Object.entries(value as Record<string, unknown>)) {
    if (!['0', '1', '2', '3', '4', '5', '6'].includes(key)) {
      throw new Error(`weeklyHours: día inválido "${key}" (usar "0"=domingo … "6"=sábado)`)
    }
    if (day === null) {
      result[key as keyof WeeklyHours] = null
      continue
    }
    const d = day as Record<string, unknown>
    if (typeof day !== 'object' || !isValidHHMM(d.open) || !isValidHHMM(d.close)) {
      throw new Error(`weeklyHours: horario inválido para el día ${key} (esperado {open: "HH:MM", close: "HH:MM"})`)
    }
    if (d.open === d.close) {
      throw new Error(`weeklyHours: apertura y cierre no pueden coincidir (día ${key})`)
    }
    result[key as keyof WeeklyHours] = { open: d.open, close: d.close }
  }
  return result
}

/** Effective opening hours of a court on a weekday; null = closed that day. */
export function hoursForWeekday(court: CourtSchedule, weekday: number): DayHours | null {
  const weekly = parseWeeklyHours(court.weeklyHours)
  const key = String(weekday) as keyof WeeklyHours
  if (weekly && key in weekly) return weekly[key] ?? null
  return { open: court.openTime, close: court.closeTime }
}

/**
 * Generates the schedule bands for one day from opening hours and a band duration.
 * A close time ≤ the open time crosses midnight ("00:00" = midnight, "01:00" = 1 AM
 * of the next day), so late bands can start or end past midnight — their offsets say
 * on which calendar day relative to the grid's dateKey they actually fall.
 */
export function generateBands(
  openTime: string,
  closeTime: string,
  slotDurationMinutes: number = DEFAULT_SLOT_DURATION_MINUTES,
): ScheduleBand[] {
  const open = minutesOf(openTime)
  let close = minutesOf(closeTime)
  if (close <= open) close += 1440

  const bands: ScheduleBand[] = []
  let cursor = open
  while (cursor + slotDurationMinutes <= close) {
    const next = cursor + slotDurationMinutes
    bands.push({
      start: formatMinutes(cursor),
      end: formatMinutes(next),
      startOffset: Math.floor(cursor / 1440),
      endOffset: Math.floor(next / 1440),
    })
    cursor = next
  }
  return bands
}

/** The bands a court offers on a specific club-local day (weekday-aware). */
export function bandsForDate(court: CourtSchedule, dateKey: string): ScheduleBand[] {
  return bandsForWeekday(court, weekdayOfKey(dateKey))
}

/** The bands a court offers on a weekday (0 = Sunday … 6 = Saturday). */
export function bandsForWeekday(court: CourtSchedule, weekday: number): ScheduleBand[] {
  const hours = hoursForWeekday(court, weekday)
  if (!hours) return []
  return generateBands(hours.open, hours.close, court.slotDurationMinutes)
}

/** Finds a band by its start time within a court's generated schedule. */
export function findBandInSchedule(bands: ScheduleBand[], start: string): ScheduleBand | undefined {
  return bands.find(b => b.start === start)
}

/** Minutes since the grid day's midnight — chronological sort key across midnight. */
export function bandSortMinutes(band: ScheduleBand): number {
  return band.startOffset * 1440 + minutesOf(band.start)
}

/** UTC start/end instants for a band on a given club-local day. */
export function bandDateTimes(dateKey: string, band: ScheduleBand): { startsAt: Date; endsAt: Date } {
  const startsAt = wallTimeToUtc(band.startOffset ? shiftDateKey(dateKey, band.startOffset) : dateKey, band.start)
  const endsAt = wallTimeToUtc(band.endOffset ? shiftDateKey(dateKey, band.endOffset) : dateKey, band.end)
  return { startsAt, endsAt }
}
