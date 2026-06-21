import { CourtOption, SlotOption } from '../types'

/**
 * Resolves a free-text court reference to one of the offered courts.
 * Matches by name in either direction so "central", "la 2" or the full name all
 * land — used both by the deterministic handler and the LLM tool dispatcher.
 */
export function matchCourt(text: string, courts: CourtOption[]): CourtOption | undefined {
  const q = text.toLowerCase().trim()
  if (!q) return undefined
  return courts.find(c => {
    const cn = c.name.toLowerCase()
    return cn === q || cn.includes(q) || q.includes(cn)
  })
}

/**
 * Resolves a free-text time reference to one of the offered slots by matching the
 * first hour (and optional minutes) found in the text against the band start.
 * Handles "18", "las 18", "18hs", "18:30" and the LLM's canonical "HH:MM".
 * Returns undefined for non-numeric phrasings ("el último") so the caller can
 * defer to the LLM.
 */
export function matchSlot(text: string, slots: SlotOption[]): SlotOption | undefined {
  const m = text.match(/(\d{1,2})(?:[:.\s]?(\d{2}))?/)
  if (!m) return undefined
  const hh = m[1].padStart(2, '0')
  const mm = m[2]
  return slots.find(s => (mm ? s.bandStart === `${hh}:${mm}` : s.bandStart.slice(0, 2) === hh))
}
