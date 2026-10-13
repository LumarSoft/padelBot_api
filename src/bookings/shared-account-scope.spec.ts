import { BookingsService } from './bookings.service'
import { SALES_DEMO_SLUG } from '../demo/sales-demo.seed'

/**
 * A transfer seen on the SHARED env MercadoPago account carries no club. It may only confirm a
 * booking of a club that relies on that account: never one of a club that connected its own
 * MercadoPago (reconciled scoped, with its DNI rules), and never a simulated booking of the
 * sales demo club.
 */
function setup() {
  const prisma = {
    booking: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    club: { findUnique: jest.fn().mockResolvedValue({ requireDniMatch: false }) },
  }
  const service = new BookingsService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never)
  return { service, prisma }
}

describe('shared MercadoPago account matching', () => {
  it('only looks at AUTO clubs without their own account, never the demo club', async () => {
    const { service, prisma } = setup()
    await service.confirmPaymentByAmount(1050000, 'mp-1', new Date())
    const where = prisma.booking.findMany.mock.calls[0][0].where
    expect(where.clubId).toBeUndefined()
    expect(where.club).toEqual({ paymentVerificationMode: 'AUTO', mpAccessToken: null, slug: { not: SALES_DEMO_SLUG } })
  })

  it('keeps a club-scoped match scoped to that club only', async () => {
    const { service, prisma } = setup()
    await service.confirmPaymentByAmount(1050000, 'mp-1', new Date(), 'club-1')
    const where = prisma.booking.findMany.mock.calls[0][0].where
    expect(where.clubId).toBe('club-1')
    expect(where.club).toEqual({ paymentVerificationMode: 'AUTO' })
  })
})
