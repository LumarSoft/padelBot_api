/** A pairing between two entrants, by their index in the list handed in. */
export interface Pairing {
  /** 1-based round ("fecha") of the circle method. */
  round: number
  a: number
  b: number
}

/**
 * Everyone-plays-everyone pairings with the circle method: `count - 1` rounds for an even count
 * (`count` rounds for an odd one, where whoever meets the ghost entrant rests that round). No
 * entrant plays twice in a round.
 */
export function roundRobinPairings(count: number): Pairing[] {
  if (count < 2) return []
  const slots: (number | null)[] = Array.from({ length: count }, (_, i) => i)
  if (count % 2 === 1) slots.push(null)
  const n = slots.length

  const pairings: Pairing[] = []
  for (let round = 1; round < n; round++) {
    for (let i = 0; i < n / 2; i++) {
      const a = slots[i]
      const b = slots[n - 1 - i]
      if (a !== null && b !== null) pairings.push({ round, a: Math.min(a, b), b: Math.max(a, b) })
    }
    // Keep the first entrant fixed and rotate the rest one step.
    slots.splice(1, 0, slots.pop() as number | null)
  }
  return pairings
}

/** A pairing placed on a court during a wave ("tanda") of simultaneous matches. */
export interface WavedPairing extends Pairing {
  /** 1-based wave: the matches played at the same time. */
  wave: number
  /** 0-based index into the courts in play. */
  courtIndex: number
}

/**
 * Packs pairings into waves of at most `courtCount` simultaneous matches, keeping the circle
 * order (so rounds come out roughly in order) while never putting an entrant on two courts at
 * once. Fills each wave greedily, so a round that doesn't divide evenly by the courts shares
 * its last wave with the next round instead of leaving courts idle.
 */
export function packIntoWaves(pairings: Pairing[], courtCount: number): WavedPairing[] {
  if (courtCount < 1) throw new Error('Hace falta al menos una cancha')
  const remaining = [...pairings]
  const result: WavedPairing[] = []
  let wave = 0
  while (remaining.length > 0) {
    wave++
    const busy = new Set<number>()
    let courtIndex = 0
    for (let i = 0; i < remaining.length && courtIndex < courtCount; ) {
      const p = remaining[i]
      if (busy.has(p.a) || busy.has(p.b)) {
        i++
        continue
      }
      busy.add(p.a)
      busy.add(p.b)
      result.push({ ...p, wave, courtIndex })
      courtIndex++
      remaining.splice(i, 1)
    }
  }
  return result
}
