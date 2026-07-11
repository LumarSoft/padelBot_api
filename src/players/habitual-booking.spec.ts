import { PlayersService } from './players.service'

/**
 * "Lo de siempre": the habit is the most-repeated (weekday, start, court) among the
 * player's recent confirmed bookings, only if repeated at least twice. Times are
 * club-local (CLUB_TIMEZONE defaults to America/Argentina/Buenos_Aires, UTC-3).
 */
describe('PlayersService.habitualBooking', () => {
  function serviceWith(bookings: { startsAt: Date; courtId: string; courtName: string }[]) {
    const prisma = {
      booking: {
        findMany: jest.fn().mockResolvedValue(
          bookings.map(b => ({
            slot: { startsAt: b.startsAt, court: { id: b.courtId, name: b.courtName } },
          })),
        ),
      },
    }
    return new PlayersService(prisma as never)
  }

  // Thursdays 19:30 ART = 22:30 UTC. 2026-07-09 and 2026-07-02 are Thursdays.
  const jueves1930 = (day: string) => new Date(`${day}T22:30:00.000Z`)

  it('finds the repeated weekday+time+court', async () => {
    const service = serviceWith([
      { startsAt: jueves1930('2026-07-09'), courtId: 'c2', courtName: 'Cancha 2' },
      { startsAt: jueves1930('2026-07-02'), courtId: 'c2', courtName: 'Cancha 2' },
      { startsAt: new Date('2026-07-06T21:00:00.000Z'), courtId: 'c1', courtName: 'Cancha 1' },
    ])
    const habit = await service.habitualBooking('club-1', '5493411234567')
    expect(habit).toMatchObject({ weekday: 4, bandStart: '19:30', courtId: 'c2', count: 2 })
  })

  it('returns null when nothing repeats', async () => {
    const service = serviceWith([
      { startsAt: jueves1930('2026-07-09'), courtId: 'c2', courtName: 'Cancha 2' },
      { startsAt: new Date('2026-07-06T21:00:00.000Z'), courtId: 'c1', courtName: 'Cancha 1' },
    ])
    expect(await service.habitualBooking('club-1', '5493411234567')).toBeNull()
  })

  it('returns null for an unusable phone without querying', async () => {
    const service = serviceWith([])
    expect(await service.habitualBooking('club-1', '12')).toBeNull()
  })
})
