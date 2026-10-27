import { StatsReportsService } from './stats-reports.service'

/**
 * The Monday "Tu semana en GTP" push. Tapping it must land on the app's summary screen — a push
 * that opens nothing is a push the staff learns to ignore.
 */
describe('StatsReportsService.sendWeeklySummaries', () => {
  function setup(summary: { bookings: number; botBookings: number; depositCents: number; occupancyPct: number }) {
    const prisma = { club: { findMany: jest.fn().mockResolvedValue([{ id: 'club-1', name: 'Padel Norte' }]) } }
    const notifications = { notifyClub: jest.fn().mockResolvedValue(undefined) }
    const service = new StatsReportsService(prisma as never, notifications as never)
    // The numbers themselves are aggregated elsewhere; this pins the push.
    ;(service as unknown as { weeklySummary: jest.Mock }).weeklySummary = jest.fn().mockResolvedValue(summary)
    return { service, notifications }
  }

  it('opens the summary screen', async () => {
    const { service, notifications } = setup({ bookings: 40, botBookings: 25, depositCents: 0, occupancyPct: 62 })

    await service.sendWeeklySummaries()

    expect(notifications.notifyClub).toHaveBeenCalledWith(
      'club-1',
      expect.objectContaining({
        body: expect.stringContaining('El bot te vendió 25 turnos'),
        data: { screen: 'resumen' },
      }),
    )
  })

  it("doesn't push a club that had no turnos", async () => {
    const { service, notifications } = setup({ bookings: 0, botBookings: 0, depositCents: 0, occupancyPct: 0 })

    await service.sendWeeklySummaries()

    expect(notifications.notifyClub).not.toHaveBeenCalled()
  })
})
