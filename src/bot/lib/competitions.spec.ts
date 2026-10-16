import { BotState, CompetitionOption } from '../types'
import {
  NO_OPEN_COMPETITIONS,
  competitionsList,
  competitionsResult,
  matchCompetition,
  toCompetitionOptions,
} from './competitions'

/**
 * The bot's torneos/peñas picker: it lists what's open with its date and fee, understands a tap,
 * a number or the name, and goes back to the menu when nothing is open.
 */

const options: CompetitionOption[] = [
  {
    id: 'c1',
    kind: 'TOURNAMENT',
    name: 'Torneo Primavera',
    when: 'sábado 24/10 · 09:00',
    feeCents: 1_000_000,
    categories: ['4ta', '6ta'],
  },
  { id: 'c2', kind: 'PENA', name: 'Peña de los jueves', when: 'jueves 22/10 · 20:00', feeCents: 0, categories: [] },
]

describe('toCompetitionOptions', () => {
  it('labels the next session and how many days it spans', () => {
    const [option] = toCompetitionOptions([
      {
        id: 'c1',
        kind: 'TOURNAMENT',
        name: 'Torneo Primavera',
        entryFeeCents: 1_000_000,
        dateKey: '2026-10-24',
        startTime: '09:00',
        sessionCount: 3,
        categories: ['4ta'],
      },
    ])
    expect(option.when).toBe('sábado 24/10 · 09:00 (+2 días)')
  })
})

describe('competitionsList', () => {
  it('numbers each event with its kind, date, fee and categories', () => {
    const text = competitionsList(options)
    expect(text).toContain('*1.* Torneo *Torneo Primavera*')
    expect(text).toContain('$10.000 por jugador')
    expect(text).toContain('Categorías: 4ta, 6ta')
    expect(text).toContain('*2.* Peña *Peña de los jueves*')
    expect(text).toContain('sin costo')
  })
})

describe('competitionsResult', () => {
  it('opens the picker with the options remembered', () => {
    const result = competitionsResult(options, {})
    expect(result.state).toBe(BotState.COMPETITION_PICK)
    expect(result.ctx.competitionOptions).toEqual(options)
  })

  it('goes back to the menu when nothing is open', () => {
    const result = competitionsResult([], { competitionOptions: options })
    expect(result).toMatchObject({ reply: NO_OPEN_COMPETITIONS, state: BotState.MENU })
    expect(result.ctx.competitionOptions).toBeUndefined()
  })
})

describe('matchCompetition', () => {
  it('resolves a tapped row', () => {
    expect(matchCompetition('torneo:c2', options)?.id).toBe('c2')
    expect(matchCompetition('torneo:nope', options)).toBeNull()
  })

  it('resolves the number, with or without an article', () => {
    expect(matchCompetition('1', options)?.id).toBe('c1')
    expect(matchCompetition('la 2', options)?.id).toBe('c2')
    expect(matchCompetition('3', options)).toBeNull()
  })

  it('resolves the name, ignoring case and accents', () => {
    expect(matchCompetition('primavera', options)?.id).toBe('c1')
    expect(matchCompetition('PENA DE LOS JUEVES', options)?.id).toBe('c2')
  })

  it('gives up on anything else', () => {
    expect(matchCompetition('cuánto sale?', options)).toBeNull()
  })
})
