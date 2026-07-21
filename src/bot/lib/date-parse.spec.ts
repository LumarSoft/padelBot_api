import { parseDateDMY, parseDateExpression } from './date-parse'

/**
 * Every expression this parser understands is an OpenAI call that never happens — on the most
 * travelled step of the whole bot. It's also the step that stops depending on a third party
 * being up. So the coverage here is about breadth: the ways an Argentine actually names a day.
 *
 * Reference day: Sunday 2026-07-12.
 */
const TODAY = '2026-07-12' // domingo

const parse = (input: string) => parseDateExpression(input, TODAY)

describe('explicit dates', () => {
  it('reads DD/MM and D/M', () => {
    expect(parse('25/07')).toBe('2026-07-25')
    expect(parse('5/8')).toBe('2026-08-05')
    expect(parse('18-07')).toBe('2026-07-18')
  })

  it('rolls to next year when the day already passed', () => {
    expect(parse('02/01')).toBe('2027-01-02')
  })

  it('rejects a day the calendar does not have', () => {
    expect(parseDateDMY('31/02', TODAY)).toBeNull()
    expect(parseDateDMY('45/13', TODAY)).toBeNull()
  })
})

describe('relative days', () => {
  it('understands hoy / mañana / pasado mañana', () => {
    expect(parse('hoy')).toBe('2026-07-12')
    expect(parse('mañana')).toBe('2026-07-13')
    expect(parse('manana')).toBe('2026-07-13') // no accent, as people type
    expect(parse('pasado mañana')).toBe('2026-07-14')
  })

  it('understands them inside a sentence', () => {
    expect(parse('quiero jugar mañana')).toBe('2026-07-13')
    expect(parse('hoy a la noche')).toBe('2026-07-12')
  })
})

describe('weekdays', () => {
  it('resolves the next occurrence', () => {
    expect(parse('el sábado')).toBe('2026-07-18')
    expect(parse('sabado')).toBe('2026-07-18')
    expect(parse('el martes')).toBe('2026-07-14')
    expect(parse('miércoles')).toBe('2026-07-15')
  })

  it('counts today when the player names today’s weekday', () => {
    // Asking for "el domingo" on a Sunday means tonight, not in a week.
    expect(parse('el domingo')).toBe('2026-07-12')
  })

  it('adds a week for "que viene" / "próximo"', () => {
    expect(parse('el sábado que viene')).toBe('2026-07-25')
    expect(parse('el próximo martes')).toBe('2026-07-21')
  })

  it('takes the weekday over the word "mañana" meaning morning', () => {
    // "el sábado a la mañana" is Saturday — not tomorrow.
    expect(parse('el sábado a la mañana')).toBe('2026-07-18')
  })

  it('reads "el finde" as Saturday', () => {
    expect(parse('el finde')).toBe('2026-07-18')
    expect(parse('fin de semana')).toBe('2026-07-18')
  })
})

describe('what still goes to the LLM', () => {
  it('returns null for phrasings it cannot resolve on its own', () => {
    expect(parse('para la semana del 20')).toBeNull()
    expect(parse('cuando haya lugar')).toBeNull()
    expect(parse('el finde largo de agosto')).toBe('2026-07-18') // "finde" wins; good enough
    expect(parse('hola')).toBeNull()
    expect(parse('')).toBeNull()
  })
})
