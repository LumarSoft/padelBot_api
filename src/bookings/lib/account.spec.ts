import { computeAccount, splitEqually } from './account'

/** La cuenta del turno: cancha ÷ 4 + consumos por jugador − lo que cada uno ya puso. */
describe('computeAccount', () => {
  const base = { payments: [], depositPaidCents: 0, unassignedPaidCents: 0, settledAt: null }

  it('splits cents exactly, leftovers to the first positions', () => {
    expect(splitEqually(10001, 4)).toEqual([2501, 2500, 2500, 2500])
    expect(splitEqually(10001, 4).reduce((a, b) => a + b, 0)).toBe(10001)
  })

  it('charges court ÷ 4 plus each player’s consumo share', () => {
    const view = computeAccount({
      ...base,
      courtPriceCents: 4000000, // $40.000
      lines: [{ unitPriceCents: 300000, quantity: 2, players: [1, 2] }], // $6.000 J1+J2
    })
    expect(view.totalCents).toBe(4600000)
    expect(view.players[0].owesCents).toBe(1000000 + 300000)
    expect(view.players[1].owesCents).toBe(1000000 + 300000)
    expect(view.players[2].owesCents).toBe(1000000)
  })

  it('credits the seña to J1 (quien reservó)', () => {
    const view = computeAccount({
      ...base,
      courtPriceCents: 4000000,
      lines: [],
      depositPaidCents: 1000000,
    })
    expect(view.players[0].paidCents).toBe(1000000)
    expect(view.players[0].remainingCents).toBe(0)
    expect(view.players[1].remainingCents).toBe(1000000)
    expect(view.remainingCents).toBe(3000000)
  })

  it('reaches zero remaining when everyone pays their share', () => {
    const payment = (slot: number) => ({
      id: `p${slot}`,
      playerSlot: slot,
      amountCents: 1000000,
      method: 'CASH',
      createdAt: new Date(),
    })
    const view = computeAccount({
      ...base,
      courtPriceCents: 4000000,
      lines: [],
      depositPaidCents: 1000000, // J1 ya puso la seña
      payments: [payment(2), payment(3), payment(4)],
    })
    expect(view.paidCents).toBe(4000000)
    expect(view.remainingCents).toBe(0)
    expect(view.players.every(p => p.remainingCents === 0)).toBe(true)
  })

  it('counts the legacy unassigned front-desk amount toward the global bill', () => {
    const view = computeAccount({
      ...base,
      courtPriceCents: 4000000,
      lines: [],
      unassignedPaidCents: 3000000,
      depositPaidCents: 1000000,
    })
    expect(view.remainingCents).toBe(0)
  })
})
