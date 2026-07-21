import { shiftDateKey, todayKey, weekdayOfKey } from '../../availability/lib/datetime'

/**
 * Deterministic parsing of how players actually name a day.
 *
 * The date step is the single most travelled fork in the bot, and "hoy" / "mañana" / "el
 * sábado" are most of the answers it gets. Every one of them used to be an OpenAI call: money
 * spent, latency added, and a booking flow that depended on a third party being up to resolve
 * the word "mañana". Anything this function understands never reaches the LLM.
 *
 * Returns a "YYYY-MM-DD" key in the club's timezone, or null so the caller can fall back.
 */

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
}

/** "el próximo martes", "el martes que viene" → the occurrence a week further out. */
const NEXT_WEEK = /\b(proxim[oa]|que viene|siguiente|entrante)\b/

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[!¡¿?.,]/g, '')
    .trim()

/** "DD/MM" or "D-M" → "YYYY-MM-DD", rolling to next year when the day already passed. */
export function parseDateDMY(input: string, today: string = todayKey()): string | null {
  const m = input.trim().match(/^(\d{1,2})[/-](\d{1,2})$/)
  if (!m) return null

  const day = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  // Rejects days the calendar doesn't have (31/02) using a UTC probe.
  const probe = new Date(Date.UTC(2000, month - 1, day))
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null

  const [todayY, todayM, todayD] = today.split('-').map(Number)
  const year = month < todayM || (month === todayM && day < todayD) ? todayY + 1 : todayY

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Any way a player names a day: "25/06", "hoy", "mañana", "pasado mañana", "el sábado",
 * "el sábado que viene", "el finde". Null when it isn't a date at all (→ LLM).
 */
export function parseDateExpression(input: string, today: string = todayKey()): string | null {
  const explicit = parseDateDMY(input, today)
  if (explicit) return explicit

  const t = normalize(input)
  if (!t) return null

  if (/\bhoy\b/.test(t)) return today
  // Checked before "mañana": "pasado mañana" contains it.
  if (/\bpasado manana\b/.test(t)) return shiftDateKey(today, 2)
  // "mañana" is also "morning" in Spanish — "mañana a las 10" is tomorrow, but "el sábado a
  // la mañana" is Saturday. A weekday in the message always wins, so check those first.
  const weekday = matchWeekday(t)
  if (weekday !== null) return nextWeekdayKey(weekday, t, today)
  if (/\bmanana\b/.test(t)) return shiftDateKey(today, 1)
  // "el finde" → Saturday, the day a player means by it.
  if (/\bfinde\b|\bfin de semana\b/.test(t)) return nextWeekdayKey(WEEKDAYS.sabado, t, today)

  return null
}

function matchWeekday(normalized: string): number | null {
  for (const [name, index] of Object.entries(WEEKDAYS)) {
    // "sabados" / "miercoles" both land; a bare word boundary keeps "juevesito" out.
    if (new RegExp(`\\b${name}s?\\b`).test(normalized)) return index
  }
  return null
}

/**
 * The next occurrence of a weekday. Today counts (someone asking for "el sábado" on a
 * Saturday means tonight), unless they said "el sábado que viene" — then it's a week later.
 */
function nextWeekdayKey(weekday: number, normalized: string, today: string): string {
  const daysUntil = (weekday - weekdayOfKey(today) + 7) % 7
  const base = shiftDateKey(today, daysUntil)
  return NEXT_WEEK.test(normalized) ? shiftDateKey(base, 7) : base
}
