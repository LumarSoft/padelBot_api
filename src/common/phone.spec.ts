import { nationalArPhone, samePhone, whatsAppRecipient } from './phone'

describe('phone helpers', () => {
  it.each([
    ['5493415551234', '3415551234'],
    ['+54 9 341 555-1234', '3415551234'],
    ['54 341 5551234', '3415551234'],
    ['341 555-1234', '3415551234'],
    ['0341 15 555 1234', '3415551234'],
    ['341 15 5551234', '3415551234'],
    ['011 15 1234 5678', '1112345678'],
    ['+54 9 11 1234-5678', '1112345678'],
  ])('reduces %s to the national number', (raw, expected) => {
    expect(nationalArPhone(raw)).toBe(expected)
  })

  it('gives up on numbers it cannot place', () => {
    expect(nationalArPhone('555-1234')).toBeNull()
    expect(nationalArPhone('')).toBeNull()
    expect(nationalArPhone(null)).toBeNull()
  })

  it('builds the wa_id to message a hand-typed fijo phone', () => {
    expect(whatsAppRecipient('0341 15 555 1234')).toBe('5493415551234')
    // Another country, typed in international form: sent as is.
    expect(whatsAppRecipient('+598 99 123 456')).toBe('59899123456')
    expect(whatsAppRecipient('555 1234')).toBeNull()
  })

  it('matches the wa_id that tapped against the phone the front desk typed', () => {
    expect(samePhone('0341 15 555 1234', '5493415551234')).toBe(true)
    expect(samePhone('341 555-1234', '5493415559999')).toBe(false)
    expect(samePhone('59899123456', '+598 99 123 456')).toBe(true)
    expect(samePhone(null, '5493415551234')).toBe(false)
  })
})
