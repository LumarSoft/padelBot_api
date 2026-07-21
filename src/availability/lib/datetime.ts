/**
 * Timezone-correct date helpers for the bot and availability layer.
 *
 * Slots are stored as absolute UTC instants in the DB. The club, its players and
 * the admin panel all reason in a single wall-clock timezone (the club's local
 * time). Computing day boundaries with `new Date('YYYY-MMDDT00:00:00')` is wrong
 * because that is interpreted in the *server's* timezone — which differs from the
 * club's whenever the API runs on a UTC host. Every helper here pins the wall
 * clock to `CLUB_TIMEZONE` so results are identical no matter where the API runs.
 */

export const CLUB_TIMEZONE = process.env.CLUB_TIMEZONE ?? 'America/Argentina/Buenos_Aires'

const SPANISH_WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Offset (in ms) of `timeZone` at a given absolute instant. East of UTC is positive. */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(instant)
  const map: Record<string, number> = {}
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = Number(p.value)
  }
  // `Intl` can emit hour "24" for midnight; normalize to 0.
  const hour = map.hour === 24 ? 0 : map.hour
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second)
  return asUtc - instant.getTime()
}

/** Converts a wall-clock time in the club timezone to the matching UTC instant. */
export function zonedWallTimeToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  // Start by assuming the wall time is UTC, then correct by the real offset at
  // that instant. One correction is enough for fixed-offset zones (Argentina has
  // no DST) and is accurate for DST zones outside the transition hour.
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const offset = tzOffsetMs(new Date(guess), CLUB_TIMEZONE)
  return new Date(guess - offset)
}

/** "YYYY-MM-DD" (club timezone) for an absolute instant. */
export function toDateKey(instant: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CLUB_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

/** Today's "YYYY-MM-DD" in the club timezone. */
export function todayKey(): string {
  return toDateKey(new Date())
}

/** Half-open UTC range `[gte, lt)` covering one club-local calendar day. */
export function dayRangeUtc(dateKey: string): { gte: Date; lt: Date } {
  const [y, m, d] = dateKey.split('-').map(Number)
  const gte = zonedWallTimeToUtc(y, m, d, 0, 0)
  // Next calendar day at 00:00 local.
  const nextUtcMidnight = new Date(Date.UTC(y, m - 1, d) + 24 * 60 * 60 * 1000)
  const lt = zonedWallTimeToUtc(
    nextUtcMidnight.getUTCFullYear(),
    nextUtcMidnight.getUTCMonth() + 1,
    nextUtcMidnight.getUTCDate(),
    0,
    0,
  )
  return { gte, lt }
}

/** Shifts a "YYYY-MM-DD" key by a number of days (calendar arithmetic, DST-safe). */
export function shiftDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000)
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
}

/** UTC instant for a wall-clock "HH:MM" on a "YYYY-MM-DD" key, in the club timezone. */
export function wallTimeToUtc(dateKey: string, hhmm: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number)
  const [hh, mm] = hhmm.split(':').map(Number)
  return zonedWallTimeToUtc(y, m, d, hh, mm)
}

/** Day of week (0 = Sunday … 6 = Saturday) for a "YYYY-MM-DD" key, in club-local calendar. */
export function weekdayOfKey(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number)
  // Read the weekday at UTC noon so it never drifts to the adjacent day.
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
}

/** "HH:MM" (club timezone) for an absolute instant. */
export function formatTime(instant: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: CLUB_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant)
}

/** "HH:MM–HH:MM" (club timezone) for a slot's start/end. */
export function formatTimeRange(startsAt: Date, endsAt: Date): string {
  return `${formatTime(startsAt)}–${formatTime(endsAt)}`
}

/** "DD/MM" (club timezone) for an instant. */
export function formatDayMonth(instant: Date): string {
  const key = toDateKey(instant)
  const [, m, d] = key.split('-')
  return `${d}/${m}`
}

/** "DD/MM" from a "YYYY-MM-DD" key. */
export function dayMonthFromKey(dateKey: string): string {
  const [, m, d] = dateKey.split('-')
  return `${d}/${m}`
}

/** Friendly label like "martes 23/06" from a "YYYY-MM-DD" key. */
export function dayLabelFromKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  // Build a UTC noon instant for the date and read its weekday in UTC so the
  // label never drifts to the previous/next day.
  const weekdayIndex = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
  return `${SPANISH_WEEKDAYS[weekdayIndex]} ${pad2(d)}/${pad2(m)}`
}
