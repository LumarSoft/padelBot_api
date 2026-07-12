import { BandOption } from '../types'

/**
 * Splitting the day in three.
 *
 * WhatsApp lists cap at 10 rows. A club with 60-minute turns open 08:00–24:00 has 16 bands,
 * which used to mean NO botonera at all: the player fell back to free text and every single
 * reply cost an LLM call. Offering the parts of the day first keeps every step tappable, no
 * matter how the club configured its grid.
 *
 * Kept as a leaf module (types only) so both the FSM and the botonera builder can use it
 * without an import cycle through `messages`.
 */

export type PartOfDay = 'manana' | 'tarde' | 'noche'

/** Tapping a part-of-day button feeds this id back through the FSM. */
export const PART_OF_DAY_PREFIX = 'franja:'

export const PART_OF_DAY_LABELS: Record<PartOfDay, string> = {
  manana: '🌅 Mañana',
  tarde: '☀️ Tarde',
  noche: '🌙 Noche',
}

/** How the club names it in a sentence ("los horarios de la *tarde*"). */
export const PART_OF_DAY_NAMES: Record<PartOfDay, string> = {
  manana: 'mañana',
  tarde: 'tarde',
  noche: 'noche',
}

/** Minutes since the grid day's midnight (past-midnight bands sort last). */
function bandMinutes(band: { bandStart: string; sortMinutes?: number }): number {
  if (band.sortMinutes !== undefined) return band.sortMinutes
  const [h, m] = band.bandStart.split(':').map(Number)
  return h * 60 + m
}

export function partOfDay(band: { bandStart: string; sortMinutes?: number }): PartOfDay {
  const minutes = bandMinutes(band)
  // A 00:30 band belongs to the night of the day before, not to its morning.
  if (minutes >= 24 * 60) return 'noche'
  if (minutes < 12 * 60) return 'manana'
  if (minutes < 19 * 60) return 'tarde'
  return 'noche'
}

/** The part-of-day id a tapped button sends back, or null for anything else. */
export function parsePartOfDay(msg: string): PartOfDay | null {
  const m = new RegExp(`^${PART_OF_DAY_PREFIX}(manana|tarde|noche)$`).exec(msg.trim().toLowerCase())
  return m ? (m[1] as PartOfDay) : null
}

/** The parts of the day that actually have a free band, in chronological order. */
export function partsWithBands(bands: BandOption[]): PartOfDay[] {
  const order: PartOfDay[] = ['manana', 'tarde', 'noche']
  const present = new Set(bands.map(partOfDay))
  return order.filter(p => present.has(p))
}

export function bandsInPart(bands: BandOption[], part: PartOfDay): BandOption[] {
  return bands.filter(b => partOfDay(b) === part)
}
