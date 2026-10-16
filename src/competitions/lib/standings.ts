import { SetScore } from './score'

export interface StandingsMatch {
  pairAId: string | null
  pairBId: string | null
  sets: SetScore[] | null
  winnerPairId: string | null
}

export interface StandingRow {
  pairId: string
  played: number
  won: number
  lost: number
  setsWon: number
  setsLost: number
  gamesWon: number
  gamesLost: number
}

/**
 * The table of a zona or a peña, best first: matches won, then set difference, then game
 * difference, then the match between the two pairs (when exactly that decides it), then the
 * order the pairs came in (their seed). Only played matches count.
 */
export function computeStandings(pairIds: string[], matches: StandingsMatch[]): StandingRow[] {
  const rows = new Map<string, StandingRow>(
    pairIds.map(pairId => [
      pairId,
      { pairId, played: 0, won: 0, lost: 0, setsWon: 0, setsLost: 0, gamesWon: 0, gamesLost: 0 },
    ]),
  )

  const played = matches.filter(m => m.pairAId && m.pairBId && m.winnerPairId && m.sets)
  for (const m of played) {
    const a = rows.get(m.pairAId as string)
    const b = rows.get(m.pairBId as string)
    if (!a || !b) continue
    a.played++
    b.played++
    if (m.winnerPairId === a.pairId) {
      a.won++
      b.lost++
    } else {
      b.won++
      a.lost++
    }
    for (const [gamesA, gamesB] of m.sets as SetScore[]) {
      a.gamesWon += gamesA
      a.gamesLost += gamesB
      b.gamesWon += gamesB
      b.gamesLost += gamesA
      if (gamesA > gamesB) {
        a.setsWon++
        b.setsLost++
      } else {
        b.setsWon++
        a.setsLost++
      }
    }
  }

  const order = new Map(pairIds.map((id, i) => [id, i]))
  const headToHead = (x: string, y: string): number => {
    const match = played.find(m => (m.pairAId === x && m.pairBId === y) || (m.pairAId === y && m.pairBId === x))
    if (!match) return 0
    return match.winnerPairId === x ? -1 : 1
  }

  return [...rows.values()].sort(
    (x, y) =>
      y.won - x.won ||
      y.setsWon - y.setsLost - (x.setsWon - x.setsLost) ||
      y.gamesWon - y.gamesLost - (x.gamesWon - x.gamesLost) ||
      headToHead(x.pairId, y.pairId) ||
      (order.get(x.pairId) as number) - (order.get(y.pairId) as number),
  )
}
