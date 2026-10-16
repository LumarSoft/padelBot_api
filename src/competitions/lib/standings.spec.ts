import { computeStandings, StandingsMatch } from './standings'
import { SetScore } from './score'

function match(a: string, b: string, sets: SetScore[] | null): StandingsMatch {
  if (!sets) return { pairAId: a, pairBId: b, sets: null, winnerPairId: null }
  const setsA = sets.filter(([x, y]) => x > y).length
  return { pairAId: a, pairBId: b, sets, winnerPairId: setsA * 2 > sets.length ? a : b }
}

describe('computeStandings', () => {
  it('orders by matches won', () => {
    const table = computeStandings(
      ['x', 'y', 'z'],
      [match('x', 'y', [[2, 6]]), match('y', 'z', [[6, 1]]), match('x', 'z', [[6, 0]])],
    )
    expect(table.map(r => r.pairId)).toEqual(['y', 'x', 'z'])
    expect(table[0]).toMatchObject({ played: 2, won: 2, lost: 0, setsWon: 2, gamesWon: 12, gamesLost: 3 })
  })

  it('breaks a tie on wins by game difference', () => {
    // Everyone wins once; games: x +4, z 0, y -4.
    const table = computeStandings(
      ['x', 'y', 'z'],
      [match('x', 'y', [[6, 0]]), match('y', 'z', [[6, 4]]), match('z', 'x', [[6, 4]])],
    )
    expect(table.map(r => r.pairId)).toEqual(['x', 'z', 'y'])
  })

  it('falls back to the match between the two pairs', () => {
    // x and y both win twice with the same set and game difference; x beat y, so x goes first
    // even though y is listed first.
    const table = computeStandings(
      ['y', 'x', 'z', 'w'],
      [
        match('x', 'y', [[6, 4]]),
        match('z', 'x', [[6, 4]]),
        match('y', 'z', [[6, 4]]),
        match('x', 'w', [[6, 0]]),
        match('y', 'w', [[6, 0]]),
        match('w', 'z', [[6, 4]]),
      ],
    )
    expect(table.map(r => r.pairId)).toEqual(['x', 'y', 'z', 'w'])
  })

  it('keeps the seed order when nothing separates two pairs', () => {
    expect(computeStandings(['y', 'x'], []).map(r => r.pairId)).toEqual(['y', 'x'])
  })

  it('ignores unplayed matches and lists pairs with no result', () => {
    const table = computeStandings(['x', 'y'], [match('x', 'y', null)])
    expect(table).toHaveLength(2)
    expect(table.every(r => r.played === 0)).toBe(true)
  })
})
