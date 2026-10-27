/** Someone going into the bracket. `group` lets the draw keep zona-mates apart in round one. */
export interface BracketEntrant {
  pairId: string
  /** What the bracket shows before the pair is known, e.g. "1° Zona A". */
  label: string
  group?: string
}

export interface BracketMatch {
  /** 1 = first round … last = final. */
  round: number
  /** 0-based order inside the round. */
  position: number
  a: BracketEntrant | null
  b: BracketEntrant | null
  /** Where the winner goes; null for the final. */
  next: { position: number; slot: 'A' | 'B' } | null
}

/** Smallest power of two that fits `count` entrants (at least 2). */
export function bracketSize(count: number): number {
  let size = 2
  while (size < count) size *= 2
  return size
}

/**
 * Seed numbers in draw order so the top seeds can only meet late: [1, 8, 4, 5, 2, 7, 3, 6] for
 * 8. Each adjacent couple is a first-round match.
 */
export function seedOrder(size: number): number[] {
  let order = [1]
  while (order.length < size) {
    const total = order.length * 2 + 1
    order = order.flatMap(seed => [seed, total - seed])
  }
  return order
}

/**
 * Builds a single-elimination bracket from entrants ordered best first. Missing entrants become
 * byes (null), which fall on the top seeds. Then, if two zona-mates meet in round one, swaps
 * the lower one with an entrant of another first-round match where that clears both clashes.
 */
export function buildBracket(entrants: BracketEntrant[]): BracketMatch[] {
  if (entrants.length < 2) throw new Error('Hacen falta al menos 2 parejas para armar el cuadro')
  const size = bracketSize(entrants.length)
  const order = seedOrder(size)
  const draw: (BracketEntrant | null)[] = order.map(seed => entrants[seed - 1] ?? null)
  avoidGroupClashes(draw)

  const matches: BracketMatch[] = []
  let roundSize = size / 2
  let round = 1
  while (roundSize >= 1) {
    for (let position = 0; position < roundSize; position++) {
      matches.push({
        round,
        position,
        a: round === 1 ? draw[position * 2] : null,
        b: round === 1 ? draw[position * 2 + 1] : null,
        next: roundSize > 1 ? { position: Math.floor(position / 2), slot: position % 2 === 0 ? 'A' : 'B' } : null,
      })
    }
    roundSize /= 2
    round++
  }
  return matches
}

function sameGroup(x: BracketEntrant | null, y: BracketEntrant | null): boolean {
  return !!x?.group && x.group === y?.group
}

function avoidGroupClashes(draw: (BracketEntrant | null)[]): void {
  for (let m = 0; m < draw.length; m += 2) {
    if (!sameGroup(draw[m], draw[m + 1])) continue
    // Swap the second entrant (the lower seed of the match) with a second entrant elsewhere.
    for (let other = 0; other < draw.length; other += 2) {
      if (other === m) continue
      const candidate = draw[other + 1]
      if (!candidate) continue
      if (sameGroup(draw[m], candidate) || sameGroup(draw[other], draw[m + 1])) continue
      draw[other + 1] = draw[m + 1]
      draw[m + 1] = candidate
      break
    }
  }
}

/** Display name of a knockout round, counted back from the final. */
export function roundName(round: number, totalRounds: number): string {
  const fromFinal = totalRounds - round
  if (fromFinal === 0) return 'Final'
  if (fromFinal === 1) return 'Semifinal'
  if (fromFinal === 2) return 'Cuartos de final'
  if (fromFinal === 3) return 'Octavos de final'
  return `Ronda ${round}`
}
