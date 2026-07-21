import { CourtOption, SlotOption } from '../types'

/** Below this, a containment match is noise, not a court reference ("a", "la", "ok"). */
const MIN_COURT_QUERY_LENGTH = 3

/** "18:30" / "18.30" / "18h30" — an hour with explicit minutes, not glued to a date. */
const HOUR_WITH_MINUTES = /(?<![\d/-])([01]?\d|2[0-3])[:.h]([0-5]\d)(?![\d/-])/g
/** A bare hour: "18", "las 18", "18hs". Rejected inside a date ("12/07") or a longer number. */
const BARE_HOUR = /(?<![\d/-])([01]?\d|2[0-3])\s*(?:hs?|horas?)?(?![\d/:.-])/g

/** Nobody types "21:00" — they say "las nueve de la noche". Both have to land on the same band. */
const HOUR_WORDS: Record<string, number> = {
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
}

type Period = 'am' | 'pm'

/**
 * One clock reference read out of a message, already resolved to 24h.
 *
 * `cued` marks the hour as *spoken as a time* ("a las 8", "8hs", "8 de la noche") rather than a
 * number that merely happens to be in the sentence ("somos 4"). Only a cued hour earns the
 * PM guess below — otherwise "somos 4" silently books 16:00.
 */
interface TimeRef {
  hour: number
  /** null when the player named an hour but no minutes ("a las 8") — match the band by hour. */
  minute: number | null
  /** true when the player said which half of the day, so no PM guessing is needed. */
  explicitPeriod: boolean
  cued: boolean
}

const HOUR_TOKEN = new RegExp(
  // Not glued to a date ("12/07") or a longer number.
  String.raw`(?<![\d/-])` +
    // "a las" / "las" / "la" — the strongest signal that a number is an hour.
    String.raw`(?:(?<cue>a\s+las?|las?|a\s+la)\s+)?` +
    String.raw`(?<hour>\d{1,2}|${Object.keys(HOUR_WORDS).join('|')})` +
    // "18:30", "18.30", "18h30", or the spoken "y media" / "y cuarto".
    String.raw`(?:\s*[:.h]\s*(?<minute>[0-5]\d)|\s+y\s+(?<frac>media|cuarto|treinta|quince))?` +
    String.raw`\s*(?<unit>hs?|horas?)?` +
    // "de la tarde" / "por la noche" / "de la mañana" — the AM/PM carrier in spoken Spanish.
    String.raw`(?:\s*(?:de|por|a|en)\s+la\s+(?<period>manana|tarde|noche|madrugada))?` +
    String.raw`(?![\d/:.-])`,
  'g',
)

const FRACTION_MINUTES: Record<string, number> = { media: 30, treinta: 30, cuarto: 15, quince: 15 }

const hhmm = (hour: number, minute: number): string =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

/**
 * Applies the spoken half-of-day to a 12h hour. "las 9 de la noche" is 21:00, not 09:00 — reading
 * the digit and dropping the "de la noche" is how a player who asked for a night game gets
 * confirmed, and shows up, twelve hours early.
 */
function toTwentyFour(hour: number, period: Period): number {
  if (period === 'pm') return hour === 12 ? 12 : hour < 12 ? hour + 12 : hour
  return hour === 12 ? 0 : hour
}

/** Every clock reference in the message, in the order the player said them. */
function parseTimeRefs(text: string): TimeRef[] {
  const refs: TimeRef[] = []

  if (/\bmediodia\b/.test(text)) refs.push({ hour: 12, minute: 0, explicitPeriod: true, cued: true })
  if (/\bmedianoche\b/.test(text)) refs.push({ hour: 0, minute: 0, explicitPeriod: true, cued: true })

  for (const m of text.matchAll(HOUR_TOKEN)) {
    const g = m.groups
    if (!g?.hour) continue

    const word = HOUR_WORDS[g.hour]
    // A word hour is only ever an hour when it was spoken as one — "una cancha" is not 01:00.
    if (word !== undefined && !g.cue && !g.period && !g.unit && !g.minute && !g.frac) continue

    let hour = word ?? Number(g.hour)
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue

    const minute = g.minute ? Number(g.minute) : g.frac ? FRACTION_MINUTES[g.frac] : null

    const period: Period | null = g.period ? (g.period === 'tarde' || g.period === 'noche' ? 'pm' : 'am') : null
    if (period && hour >= 1 && hour <= 12) hour = toTwentyFour(hour, period)

    refs.push({
      hour,
      minute,
      explicitPeriod: period !== null,
      cued: Boolean(g.cue || g.unit || g.period || g.minute || g.frac),
    })
  }

  return refs
}

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
 * Reads the clock the way a player speaks it: digits ("18", "las 18", "18hs", "18:30", the LLM's
 * canonical "HH:MM"), words ("las nueve"), fractions ("y media") and — decisively — the half of
 * the day ("de la noche"), which is what actually carries AM/PM in Rioplatense: nobody says "a
 * las 21", they say "a las nueve de la noche". Reading the 9 and dropping the "de la noche" is
 * how a player who asked for a night game gets confirmed at 09:00 and shows up twelve hours early.
 *
 * EVERY reference in the message is tried, not just the first number — taking the first is how
 * "somos 4 y jugamos a las 18" ends up hunting for an 04:00 band. The passes are ordered so a
 * literal reading always beats a guessed one.
 *
 * Returns undefined for phrasings with no usable hour ("el último") so the caller defers to the LLM.
 */
export function matchSlot(text: string, slots: SlotOption[]): SlotOption | undefined {
  return matchByTime(text, slots, s => s.bandStart)
}

/**
 * The clock-matching itself, over anything that starts at an "HH:MM" — free bands to book, or the
 * player's own bookings ("moveme el de las nueve de la noche"). Returns undefined when the text
 * names no usable hour, or when the hour it names matches nothing.
 */
export function matchByTime<T>(text: string, items: T[], bandStartOf: (item: T) => string): T | undefined {
  const refs = parseTimeRefs(normalize(text))
  const atHour = (hour: number): T | undefined => items.find(i => Number(bandStartOf(i).slice(0, 2)) === hour)

  // 1. The player named hour AND minutes → only an exact band will do.
  for (const ref of refs) {
    if (ref.minute === null) continue
    const exact = items.find(i => bandStartOf(i) === hhmm(ref.hour, ref.minute!))
    if (exact) return exact
  }

  // 2. Literal hour, as said ("las 18" → 18:00; "las 9 de la noche" → already 21:00).
  for (const ref of refs) {
    const match = atHour(ref.hour)
    if (match) return match
  }

  // 3. Only now, the PM guess: "a las 8" at a club that opens at 09:00 can only mean 20:00. Kept
  //    last so an explicit hour elsewhere in the message always wins, and limited to hours spoken
  //    as a time, so a stray "somos 4" can never book 16:00.
  for (const ref of refs) {
    if (ref.explicitPeriod || !ref.cued || ref.hour < 1 || ref.hour > 12) continue
    const match = atHour(ref.hour + 12)
    if (match) return match
  }

  return undefined
}

/**
 * True when the message carries something that could be a clock time — digits or words.
 * Builds its own matchers: `.test()` on a /g regex advances `lastIndex` and would make
 * consecutive calls disagree with each other.
 */
export function looksLikeTime(text: string): boolean {
  const t = normalize(text)
  if (parseTimeRefs(t).length > 0) return true
  return new RegExp(HOUR_WITH_MINUTES.source).test(t) || new RegExp(BARE_HOUR.source).test(t)
}
