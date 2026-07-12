import { CourtOption, SlotOption } from '../types'

/** Below this, a containment match is noise, not a court reference ("a", "la", "ok"). */
const MIN_COURT_QUERY_LENGTH = 3

/** "18:30" / "18.30" / "18h30" — an hour with explicit minutes, not glued to a date. */
const HOUR_WITH_MINUTES = /(?<![\d/-])([01]?\d|2[0-3])[:.h]([0-5]\d)(?![\d/-])/g
/** A bare hour: "18", "las 18", "18hs". Rejected inside a date ("12/07") or a longer number. */
const BARE_HOUR = /(?<![\d/-])([01]?\d|2[0-3])\s*(?:hs?|horas?)?(?![\d/:.-])/g

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()

/** Words that carry no identity: every court is "la cancha X". */
const COURT_STOPWORDS = new Set(['cancha', 'canchas', 'la', 'el', 'los', 'las', 'de', 'del', 'en'])

/** The distinctive parts of a court reference: "la Cancha Central" → ["central"]. */
function courtTokens(text: string): string[] {
  return normalize(text)
    .split(/[\s,.-]+/)
    .filter(t => t && !COURT_STOPWORDS.has(t))
}

/**
 * Resolves a free-text court reference to one of the offered courts.
 *
 * Matching is on the court's *distinctive* tokens ("Cancha Central" → "central", "Cancha 2"
 * → "2"), so "la central", "central" and the full name all land on the same court. Plain
 * containment is only the last resort, and only for a query long enough to mean something:
 * unbounded containment is absurdly generous — a player typing "a" contains-matches
 * "Cancha 1" and gets a court assigned they never asked for.
 */
export function matchCourt(text: string, courts: CourtOption[]): CourtOption | undefined {
  const q = normalize(text)
  if (!q) return undefined

  const exact = courts.find(c => normalize(c.name) === q)
  if (exact) return exact

  const asked = courtTokens(text)
  if (asked.length === 0) return undefined

  // The player named every distinctive part of the court ("la central" → Cancha Central).
  const byToken = courts.find(c => {
    const name = courtTokens(c.name)
    return name.length > 0 && name.every(t => asked.includes(t))
  })
  if (byToken) return byToken

  if (q.length < MIN_COURT_QUERY_LENGTH) return undefined
  return courts.find(c => {
    const name = normalize(c.name)
    return name.includes(q) || q.includes(name)
  })
}

/**
 * Resolves a free-text time reference to one of the offered bands.
 *
 * Only clock-shaped tokens count ("18", "las 18", "18hs", "18:30", and the LLM's canonical
 * "HH:MM"), and EVERY such token is tried against the bands, not just the first number in the
 * message. Taking the first number is how "somos 4 y jugamos a las 18" ends up looking for an
 * 04:00 band and finding nothing; and refusing date-glued digits is what keeps "12/07" from
 * being read as noon. Returns undefined for phrasings with no usable hour ("el último") so the
 * caller can defer to the LLM.
 */
export function matchSlot(text: string, slots: SlotOption[]): SlotOption | undefined {
  const t = normalize(text)

  for (const [, hh, mm] of t.matchAll(HOUR_WITH_MINUTES)) {
    const hhmm = `${hh.padStart(2, '0')}:${mm}`
    const exact = slots.find(s => s.bandStart === hhmm)
    if (exact) return exact
  }

  for (const [, hh] of t.matchAll(BARE_HOUR)) {
    const hour = hh.padStart(2, '0')
    const match = slots.find(s => s.bandStart.slice(0, 2) === hour)
    if (match) return match
  }

  return undefined
}

/**
 * True when the message carries something that could be a clock time (0–23), date digits
 * aside. Builds its own matchers: `.test()` on a /g regex advances `lastIndex` and would make
 * consecutive calls disagree with each other.
 */
export function looksLikeTime(text: string): boolean {
  const t = normalize(text)
  return new RegExp(HOUR_WITH_MINUTES.source).test(t) || new RegExp(BARE_HOUR.source).test(t)
}
