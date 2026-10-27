import { BracketEntrant, bracketSize, buildBracket, roundName, seedOrder } from './bracket'

function entrants(n: number, groups?: string[]): BracketEntrant[] {
  return Array.from({ length: n }, (_, i) => ({ pairId: `p${i + 1}`, label: `#${i + 1}`, group: groups?.[i] }))
}

describe('bracketSize', () => {
  it('rounds up to a power of two', () => {
    expect([2, 3, 4, 5, 8, 9].map(bracketSize)).toEqual([2, 4, 4, 8, 8, 16])
  })
})

describe('seedOrder', () => {
  it('keeps the top seeds apart', () => {
    expect(seedOrder(4)).toEqual([1, 4, 2, 3])
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6])
  })
})

describe('buildBracket', () => {
  it('builds every round down to the final, linked to the next match', () => {
    const matches = buildBracket(entrants(8))
    expect(matches.filter(m => m.round === 1)).toHaveLength(4)
    expect(matches.filter(m => m.round === 2)).toHaveLength(2)
    const final = matches.filter(m => m.round === 3)
    expect(final).toHaveLength(1)
    expect(final[0].next).toBeNull()
    expect(matches.find(m => m.round === 1 && m.position === 3)?.next).toEqual({ position: 1, slot: 'B' })
  })

  it('gives the byes to the top seeds', () => {
    const first = buildBracket(entrants(6)).filter(m => m.round === 1)
    const byes = first.filter(m => !m.a || !m.b)
    expect(byes).toHaveLength(2)
    expect(byes.map(m => (m.a ?? m.b)?.pairId).sort()).toEqual(['p1', 'p2'])
  })

  it('keeps zona-mates apart in the first round', () => {
    // Winners then runners-up of zonas A and B.
    const first = buildBracket(entrants(4, ['A', 'B', 'A', 'B'])).filter(m => m.round === 1)
    for (const m of first) expect(m.a?.group).not.toBe(m.b?.group)
  })

  it('keeps zona-mates apart with four zonas', () => {
    const first = buildBracket(entrants(8, ['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D'])).filter(m => m.round === 1)
    for (const m of first) expect(m.a?.group).not.toBe(m.b?.group)
  })

  it('refuses fewer than two entrants', () => {
    expect(() => buildBracket(entrants(1))).toThrow()
  })
})

describe('roundName', () => {
  it('names the rounds counted back from the final', () => {
    expect([1, 2, 3, 4].map(r => roundName(r, 4))).toEqual([
      'Octavos de final',
      'Cuartos de final',
      'Semifinal',
      'Final',
    ])
    expect(roundName(1, 6)).toBe('Ronda 1')
  })
})
