import { StatsReportsService } from './stats-reports.service'
import { wallTimeToUtc } from '../availability/lib/datetime'

/**
 * A counter sale (venta suelta, no turno) must land in the day's cash closure: kiosk revenue
 * of the day it happened, plus the cash or QR it brought to the desk — otherwise the drawer
 * has money the report can't explain.
 */
describe('StatsReportsService.getRevenue — counter sales', () => {
  function setup(counterSales: { quantity: number; unitPriceCents: number; method: string; createdAt: Date }[]) {
    const prisma = {
      booking: { findMany: jest.fn().mockResolvedValue([]) },
      bookingProduct: { findMany: jest.fn().mockResolvedValue([]) },
      bookingPlayerPayment: { findMany: jest.fn().mockResolvedValue([]) },
      counterSale: { findMany: jest.fn().mockResolvedValue(counterSales) },
    }
    return { prisma, service: new StatsReportsService(prisma as never, {} as never) }
  }

  it('counts each sale as kiosk revenue and as cash/QR of its club-local day', async () => {
    const { prisma, service } = setup([
      { quantity: 2, unitPriceCents: 200_000, method: 'CASH', createdAt: wallTimeToUtc('2026-10-13', '21:30') },
      { quantity: 1, unitPriceCents: 300_000, method: 'QR', createdAt: wallTimeToUtc('2026-10-13', '23:50') },
      { quantity: 1, unitPriceCents: 350_000, method: 'TRANSFER', createdAt: wallTimeToUtc('2026-10-14', '00:10') },
    ])

    const report = await service.getRevenue('club-1', '2026-10-13', '2026-10-14')

    expect(prisma.counterSale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ clubId: 'club-1' }) }),
    )
    expect(report.days).toEqual([
      expect.objectContaining({ dateKey: '2026-10-13', productsCents: 700_000, cashCents: 400_000, qrCents: 300_000 }),
      // Declared transfers go with QR, like a player's payment at the bill.
      expect.objectContaining({ dateKey: '2026-10-14', productsCents: 350_000, cashCents: 0, qrCents: 350_000 }),
    ])
    expect(report.totalProductsCents).toBe(1_050_000)
    expect(report.totalCashCents).toBe(400_000)
  })
})
