import { BookingsService } from './bookings.service'

/**
 * Unit tests for the money-routing decision: given the pending bookings that share an
 * incoming transfer's amount, which one (if any) does it confirm? The method is pure
 * (no DB), so we drive it directly with constructed candidates.
 */
type Candidate = { id: string; playerDni: string | null; payerMpUserId: string | null }

describe('BookingsService.disambiguateByPayer', () => {
  const service = new BookingsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { repriceSlot: jest.fn(), repriceFutureSlots: jest.fn() } as never,
  )
  const choose = (candidates: Candidate[], payer?: { cuit?: string | null; mpUserId?: string | null }) =>
    (
      service as unknown as { disambiguateByPayer: (c: Candidate[], p?: unknown) => Candidate | null }
    ).disambiguateByPayer(candidates, payer)

  it('confirms a lone first-time (centavos) booking on amount alone', () => {
    const c: Candidate = { id: 'a', playerDni: null, payerMpUserId: null }
    expect(choose([c], { mpUserId: '111', cuit: '20111111119' })?.id).toBe('a')
  })

  it('confirms a lone round-amount booking only when the payer identity matches', () => {
    const c: Candidate = { id: 'a', playerDni: null, payerMpUserId: '999' }
    expect(choose([c], { mpUserId: '999' })?.id).toBe('a')
  })

  it('does NOT confirm a lone round-amount booking when a stranger pays the same amount', () => {
    const c: Candidate = { id: 'a', playerDni: null, payerMpUserId: '999' }
    expect(choose([c], { mpUserId: '111' })).toBeNull()
  })

  it('routes a shared round amount to the matching known payer by MercadoPago id', () => {
    const a: Candidate = { id: 'a', playerDni: null, payerMpUserId: '111' }
    const b: Candidate = { id: 'b', playerDni: null, payerMpUserId: '222' }
    expect(choose([a, b], { mpUserId: '222' })?.id).toBe('b')
  })

  it('falls back to the DNI derived from the payer CUIT when MP id is absent', () => {
    // CUIT 20-44428719-6 → DNI 44428719
    const a: Candidate = { id: 'a', playerDni: '30111111', payerMpUserId: null }
    const b: Candidate = { id: 'b', playerDni: '44428719', payerMpUserId: null }
    expect(choose([a, b], { cuit: '20444287196' })?.id).toBe('b')
  })

  it('leaves it for manual review when no candidate identity matches', () => {
    const a: Candidate = { id: 'a', playerDni: null, payerMpUserId: '111' }
    const b: Candidate = { id: 'b', playerDni: null, payerMpUserId: '222' }
    expect(choose([a, b], { mpUserId: '333' })).toBeNull()
  })

  it('leaves it for manual review when the same payer matches two bookings', () => {
    const a: Candidate = { id: 'a', playerDni: null, payerMpUserId: '111' }
    const b: Candidate = { id: 'b', playerDni: null, payerMpUserId: '111' }
    expect(choose([a, b], { mpUserId: '111' })).toBeNull()
  })
})
