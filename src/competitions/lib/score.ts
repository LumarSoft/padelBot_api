/** Games of one set, from pair A's side: [gamesA, gamesB]. */
export type SetScore = [number, number]

export type MatchFormatKey = 'ONE_SET' | 'BEST_OF_THREE'

/** A set never goes past this many games (a long super tie-break included). */
const MAX_GAMES = 99

/**
 * Validates a result for the match format and returns who won. Throws a plain Error with the
 * Spanish reason (the service turns it into a 400).
 *
 * Deliberately lenient on the games themselves: an americano or a peña often plays a set to a
 * different number of games, and the third set of a "completo" may be a super tie-break (10-8).
 * What it does enforce is that every set has a winner and the match has exactly one.
 */
export function evaluateScore(sets: SetScore[], format: MatchFormatKey): { winner: 'A' | 'B' } {
  for (const set of sets) {
    if (!Array.isArray(set) || set.length !== 2 || !set.every(g => Number.isInteger(g) && g >= 0 && g <= MAX_GAMES)) {
      throw new Error('Cada set tiene que ser un par de games, por ejemplo 6-4')
    }
    if (set[0] === set[1]) throw new Error('Un set no puede terminar empatado')
  }
  const winners = sets.map(([a, b]) => (a > b ? 'A' : 'B'))

  if (format === 'ONE_SET') {
    if (sets.length !== 1) throw new Error('Este partido se juega a un set')
    return { winner: winners[0] }
  }

  if (sets.length < 2 || sets.length > 3) throw new Error('El partido se juega al mejor de 3 sets')
  const setsA = winners.filter(w => w === 'A').length
  const setsB = winners.length - setsA
  if (sets.length === 2 && setsA !== 2 && setsB !== 2) {
    throw new Error('Con 1 set cada uno falta cargar el tercero')
  }
  if (sets.length === 3 && (setsA === 3 || setsB === 3 || winners[0] === winners[1])) {
    throw new Error('El tercer set solo se juega con 1 set cada uno')
  }
  return { winner: setsA > setsB ? 'A' : 'B' }
}
