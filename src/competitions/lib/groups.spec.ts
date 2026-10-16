import { groupName, splitIntoGroups } from './groups'

const seeds = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

describe('splitIntoGroups', () => {
  it('makes zonas of the target size when it divides evenly', () => {
    expect(splitIntoGroups(seeds(9), 3).map(g => g.length)).toEqual([3, 3, 3])
  })

  it('spreads the remainder so sizes differ by at most one', () => {
    const sizes = splitIntoGroups(seeds(11), 3).map(g => g.length)
    expect(sizes.reduce((a, b) => a + b)).toBe(11)
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(3)
  })

  it('deals seeds in a snake so the top seeds land in different zonas', () => {
    expect(splitIntoGroups(seeds(6), 3)).toEqual([
      [1, 4, 5],
      [2, 3, 6],
    ])
  })

  it('keeps everyone in one zona when there are fewer pairs than the target size', () => {
    expect(splitIntoGroups(seeds(2), 3)).toEqual([[1, 2]])
  })

  it('refuses zonas smaller than two', () => {
    expect(() => splitIntoGroups(seeds(4), 1)).toThrow()
  })
})

describe('groupName', () => {
  it('names zonas with letters', () => {
    expect([0, 1, 25, 26].map(groupName)).toEqual(['Zona A', 'Zona B', 'Zona Z', 'Zona AA'])
  })
})
