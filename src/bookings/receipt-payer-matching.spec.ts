import { BookingsService } from './bookings.service'

/**
 * Hybrid matching: the receipt photo a player sends tells us WHO paid (CUIT/DNI) and the
 * operation number, and that is matched against the transfer MercadoPago actually received.
 * The money is always the real MercadoPago movement — a photo alone never confirms anything,
 * and an ambiguous match is left for a human.
 */

const CLUB = 'club-1'
const PAID_AT = new Date('2026-10-13T01:00:00Z')

type Candidate = {
  id: string
  playerDni: string | null
  payerMpUserId: string | null
  receiptPayerDni: string | null
  receiptOperationRef: string | null
}

function setup(candidates: Candidate[], requireDniMatch = true) {
  const prisma = {
    booking: {
      findFirst: jest.fn().mockResolvedValue(null), // movement not used yet
      findMany: jest.fn().mockResolvedValue(candidates),
    },
    club: { findUnique: jest.fn().mockResolvedValue({ requireDniMatch }) },
  }
  const service = new BookingsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  )
  const confirm = jest.spyOn(service, 'confirmPayment').mockResolvedValue(true)
  return { service, confirm }
}

const pending = (over: Partial<Candidate>): Candidate => ({
  id: 'b1',
  playerDni: null,
  payerMpUserId: null,
  receiptPayerDni: null,
  receiptOperationRef: null,
  ...over,
})

describe('matching a MercadoPago transfer with the receipt the player sent', () => {
  it('confirms when the receipt operation number is this MercadoPago payment', async () => {
    const { service, confirm } = setup([
      pending({ id: 'b1', receiptOperationRef: '182842711557' }),
      pending({ id: 'b2' }),
    ])
    const id = await service.confirmPaymentByAmount(1050000, '182842711557', PAID_AT, CLUB, { cuit: null })
    expect(id).toBe('b1')
    expect(confirm).toHaveBeenCalledWith('b1', '182842711557', { cuit: null })
  })

  it('confirms a transfer from someone else when their CUIT is on the receipt', async () => {
    // The player gave no DNI; a friend (DNI 30111222) paid and the player sent the receipt.
    const { service } = setup([pending({ id: 'b1', receiptPayerDni: '30111222' })])
    const id = await service.confirmPaymentByAmount(1050000, 'mp-9', PAID_AT, CLUB, { cuit: '20301112229' })
    expect(id).toBe('b1')
  })

  it('still confirms the classic way: payer DNI equals the DNI given at booking', async () => {
    const { service } = setup([pending({ id: 'b1', playerDni: '44765283' })])
    const id = await service.confirmPaymentByAmount(1050000, 'mp-9', PAID_AT, CLUB, { cuit: '20447652839' })
    expect(id).toBe('b1')
  })

  it('leaves it for a human when a receipt claims the same payer as another booking', async () => {
    // A forged receipt copying someone else's CUIT can't steal their real transfer: two
    // bookings now point to the same payer, so nothing is confirmed automatically.
    const { service, confirm } = setup([
      pending({ id: 'b1', playerDni: '30111222' }),
      pending({ id: 'b2', receiptPayerDni: '30111222' }),
    ])
    const id = await service.confirmPaymentByAmount(1050000, 'mp-9', PAID_AT, CLUB, { cuit: '20301112229' })
    expect(id).toBeNull()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('does not confirm when the payer matches neither the DNI nor any receipt', async () => {
    const { service, confirm } = setup([pending({ id: 'b1', receiptPayerDni: '30111222' })])
    const id = await service.confirmPaymentByAmount(1050000, 'mp-9', PAID_AT, CLUB, { cuit: '20999888770' })
    expect(id).toBeNull()
    expect(confirm).not.toHaveBeenCalled()
  })
})
