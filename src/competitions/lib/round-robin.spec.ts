import { packIntoWaves, roundRobinPairings } from './round-robin'

function key(a: number, b: number): string {
  return `${Math.min(a, b)}-${Math.max(a, b)}`
}

describe('roundRobinPairings', () => {
  it.each([2, 3, 4, 5, 6, 7, 8])('pairs every entrant with every other exactly once (%i entrants)', count => {
    const pairings = roundRobinPairings(count)
    expect(pairings).toHaveLength((count * (count - 1)) / 2)
    expect(new Set(pairings.map(p => key(p.a, p.b))).size).toBe(pairings.length)
  })

  it('never has an entrant play twice in the same round', () => {
    for (const count of [4, 5, 6, 7]) {
      const byRound = new Map<number, number[]>()
      for (const p of roundRobinPairings(count)) {
        byRound.set(p.round, [...(byRound.get(p.round) ?? []), p.a, p.b])
      }
      for (const entrants of byRound.values()) {
        expect(new Set(entrants).size).toBe(entrants.length)
      }
    }
  })

  it('uses count - 1 rounds for an even count and count rounds for an odd one', () => {
    expect(Math.max(...roundRobinPairings(6).map(p => p.round))).toBe(5)
    expect(Math.max(...roundRobinPairings(5).map(p => p.round))).toBe(5)
  })

  it('returns nothing for fewer than two entrants', () => {
    expect(roundRobinPairings(0)).toEqual([])
    expect(roundRobinPairings(1)).toEqual([])
  })
})

describe('packIntoWaves', () => {
  it('never uses more courts than available nor puts an entrant on two courts at once', () => {
    const waved = packIntoWaves(roundRobinPairings(7), 2)
    const byWave = new Map<number, typeof waved>()
    for (const p of waved) byWave.set(p.wave, [...(byWave.get(p.wave) ?? []), p])
    for (const matches of byWave.values()) {
      expect(matches.length).toBeLessThanOrEqual(2)
      const entrants = matches.flatMap(m => [m.a, m.b])
      expect(new Set(entrants).size).toBe(entrants.length)
      expect(matches.map(m => m.courtIndex)).toEqual(matches.map((_, i) => i))
    }
  })

  it('keeps every pairing', () => {
    const pairings = roundRobinPairings(5)
    expect(packIntoWaves(pairings, 2)).toHaveLength(pairings.length)
  })

  it('fills courts across rounds instead of leaving them idle', () => {
    // 6 pairs: 3 matches per round, 15 matches in all. With 2 courts the waves pack to 8, not 10.
    const waved = packIntoWaves(roundRobinPairings(6), 2)
    expect(Math.max(...waved.map(p => p.wave))).toBe(8)
  })

  it('refuses zero courts', () => {
    expect(() => packIntoWaves(roundRobinPairings(4), 0)).toThrow()
  })
})
