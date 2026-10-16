/**
 * Splits seeded entrants (best first) into zonas of about `groupSize`: as many zonas as fit
 * whole, the remainder spread so sizes differ by at most one. Seeds are dealt in a snake (A, B,
 * C, C, B, A…) so the strongest pairs don't share a zona.
 */
export function splitIntoGroups<T>(seeded: T[], groupSize: number): T[][] {
  if (groupSize < 2) throw new Error('Cada zona necesita al menos 2 parejas')
  const groupCount = Math.max(1, Math.floor(seeded.length / groupSize))
  const groups: T[][] = Array.from({ length: groupCount }, () => [])
  seeded.forEach((entrant, i) => {
    const lap = Math.floor(i / groupCount)
    const offset = i % groupCount
    groups[lap % 2 === 0 ? offset : groupCount - 1 - offset].push(entrant)
  })
  return groups
}

/** "Zona A", "Zona B"… (then "Zona AA" past Z, which no real torneo reaches). */
export function groupName(index: number): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const letter = letters[index % letters.length]
  return `Zona ${letter.repeat(Math.floor(index / letters.length) + 1)}`
}
