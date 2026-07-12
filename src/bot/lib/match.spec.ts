import { looksLikeTime, matchCourt, matchSlot } from './match'
import { CourtOption, SlotOption } from '../types'

/**
 * The matchers stand between a free-text WhatsApp message and a booking. Being too generous
 * here doesn't produce an error — it produces a court the player never asked for, at an hour
 * they never said, which they only discover when they show up.
 */

const courts: CourtOption[] = [
  { id: 'c1', name: 'Cancha 1' },
  { id: 'c2', name: 'Cancha Central' },
]

const slots: SlotOption[] = [
  { bandStart: '09:00', label: '09:00–10:30', price: 20000 },
  { bandStart: '18:00', label: '18:00–19:30', price: 25000 },
  { bandStart: '19:30', label: '19:30–21:00', price: 25000 },
]

describe('matchCourt', () => {
  it('resolves the exact name and the way players actually write it', () => {
    expect(matchCourt('Cancha 1', courts)?.id).toBe('c1')
    expect(matchCourt('cancha 1', courts)?.id).toBe('c1')
    expect(matchCourt('central', courts)?.id).toBe('c2')
    expect(matchCourt('la Central', courts)?.id).toBe('c2')
  })

  it('ignores accents', () => {
    expect(matchCourt('cánchá central', courts)?.id).toBe('c2')
  })

  it('does NOT assign a court from a stray letter', () => {
    // "cancha 1".includes("a") is true — that used to book Cancha 1 for a player who
    // typed a single letter.
    expect(matchCourt('a', courts)).toBeUndefined()
    expect(matchCourt('la', courts)).toBeUndefined()
    expect(matchCourt('ok', courts)).toBeUndefined()
  })

  it('returns nothing for a message that names no court', () => {
    expect(matchCourt('dale gracias', courts)).toBeUndefined()
    expect(matchCourt('', courts)).toBeUndefined()
  })
})

describe('matchSlot', () => {
  it('understands the ways players say an hour', () => {
    expect(matchSlot('18', slots)?.bandStart).toBe('18:00')
    expect(matchSlot('las 18', slots)?.bandStart).toBe('18:00')
    expect(matchSlot('18hs', slots)?.bandStart).toBe('18:00')
    expect(matchSlot('a las 19:30', slots)?.bandStart).toBe('19:30')
    expect(matchSlot('19.30', slots)?.bandStart).toBe('19:30')
    expect(matchSlot('09:00', slots)?.bandStart).toBe('09:00') // the LLM's canonical form
  })

  it('finds the hour even when another number comes first', () => {
    // Taking the first number in the message would look for an 04:00 band and give up.
    expect(matchSlot('somos 4 y jugamos a las 18', slots)?.bandStart).toBe('18:00')
  })

  it('does not read a date as an hour', () => {
    expect(matchSlot('12/07', slots)).toBeUndefined()
    expect(matchSlot('el 18/07', slots)).toBeUndefined()
  })

  it('returns nothing for a time the club does not offer', () => {
    expect(matchSlot('a las 23', slots)).toBeUndefined()
    expect(matchSlot('a las 30', slots)).toBeUndefined()
  })

  it('defers non-numeric phrasings to the LLM', () => {
    expect(matchSlot('el último', slots)).toBeUndefined()
    expect(matchSlot('el más temprano', slots)).toBeUndefined()
  })
})

describe('looksLikeTime', () => {
  it('recognises clock references and nothing else', () => {
    expect(looksLikeTime('a las 18')).toBe(true)
    expect(looksLikeTime('18:30')).toBe(true)
    expect(looksLikeTime('el último')).toBe(false)
    expect(looksLikeTime('cualquiera')).toBe(false)
  })

  it('is stable across consecutive calls (no leaked regex lastIndex)', () => {
    // A /g regex reused with .test() advances lastIndex and starts disagreeing with itself.
    expect(looksLikeTime('a las 18')).toBe(true)
    expect(looksLikeTime('a las 18')).toBe(true)
    expect(looksLikeTime('a las 18')).toBe(true)
  })
})
