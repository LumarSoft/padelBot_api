import { evaluateScore } from './score'

describe('evaluateScore', () => {
  describe('ONE_SET', () => {
    it('returns the winner of the single set', () => {
      expect(evaluateScore([[6, 4]], 'ONE_SET')).toEqual({ winner: 'A' })
      expect(evaluateScore([[5, 7]], 'ONE_SET')).toEqual({ winner: 'B' })
    })

    it('accepts a set to any number of games (americano, peña)', () => {
      expect(evaluateScore([[9, 7]], 'ONE_SET')).toEqual({ winner: 'A' })
    })

    it('refuses more than one set', () => {
      expect(() =>
        evaluateScore(
          [
            [6, 4],
            [6, 3],
          ],
          'ONE_SET',
        ),
      ).toThrow('un set')
    })
  })

  describe('BEST_OF_THREE', () => {
    it('wins in two straight sets', () => {
      expect(
        evaluateScore(
          [
            [6, 4],
            [7, 5],
          ],
          'BEST_OF_THREE',
        ),
      ).toEqual({ winner: 'A' })
    })

    it('wins in three sets, the third a super tie-break', () => {
      expect(
        evaluateScore(
          [
            [6, 4],
            [3, 6],
            [8, 10],
          ],
          'BEST_OF_THREE',
        ),
      ).toEqual({ winner: 'B' })
    })

    it('asks for the third set when the first two are split', () => {
      expect(() =>
        evaluateScore(
          [
            [6, 4],
            [3, 6],
          ],
          'BEST_OF_THREE',
        ),
      ).toThrow('tercero')
    })

    it('refuses a third set after a 2-0', () => {
      expect(() =>
        evaluateScore(
          [
            [6, 4],
            [6, 4],
            [6, 4],
          ],
          'BEST_OF_THREE',
        ),
      ).toThrow('tercer set')
    })

    it('refuses a single set', () => {
      expect(() => evaluateScore([[6, 4]], 'BEST_OF_THREE')).toThrow('mejor de 3')
    })
  })

  it('refuses a tied set', () => {
    expect(() => evaluateScore([[5, 5]], 'ONE_SET')).toThrow('empatado')
  })

  it('refuses negative or fractional games', () => {
    expect(() => evaluateScore([[-1, 6]], 'ONE_SET')).toThrow()
    expect(() => evaluateScore([[6.5, 4]], 'ONE_SET')).toThrow()
  })
})
