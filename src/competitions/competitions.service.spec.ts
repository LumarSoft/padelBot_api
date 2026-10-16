import { ConflictException } from '@nestjs/common'
import { CompetitionKind, SlotStatus } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { PlayersService } from '../players/players.service'
import { BookingEventsService } from '../events/booking-events.service'
import { CompetitionsService } from './competitions.service'

/**
 * Court blocking of a torneo / peña: the event takes every band of the grid that overlaps its
 * window, never half of them. Missing slots are created BLOCKED and tagged, AVAILABLE ones are
 * claimed, a band blocked for something else is left alone, and a booked turno in the way
 * refuses the whole thing. The DB is a jest-mocked Prisma (the transaction runs the callback
 * against the same mock); timezone is UTC in tests, the club's is UTC-3.
 */

const CLUB = 'club-1'
// Bands every 90' from 09:00: 19:30, 21:00 and 22:30 overlap a 20:00–23:00 peña.
const court = {
  id: 'court-1',
  name: 'Cancha 1',
  priceCents: 3_000_000,
  openTime: '09:00',
  closeTime: '00:00',
  slotDurationMinutes: 90,
  weeklyHours: null,
}
const at = (iso: string) => new Date(iso)
const BAND_1930 = { startsAt: at('2026-10-17T22:30:00Z'), endsAt: at('2026-10-18T00:00:00Z') }
const BAND_2100 = { startsAt: at('2026-10-18T00:00:00Z'), endsAt: at('2026-10-18T01:30:00Z') }
const BAND_2230 = { startsAt: at('2026-10-18T01:30:00Z'), endsAt: at('2026-10-18T03:00:00Z') }

function setup(existingSlots: Record<string, unknown>[] = []) {
  const prisma = {
    court: { findMany: jest.fn().mockResolvedValue([court]) },
    competition: {
      create: jest.fn().mockResolvedValue({ id: 'comp-1' }),
      findFirst: jest.fn().mockResolvedValue({
        id: 'comp-1',
        kind: CompetitionKind.PENA,
        entryFeeCents: 0,
        courts: [],
        categories: [],
        pairs: [],
        matches: [],
      }),
    },
    slot: {
      findMany: jest.fn().mockResolvedValue(existingSlots),
      updateMany: jest.fn().mockImplementation(({ where }) => Promise.resolve({ count: where.id?.in?.length ?? 0 })),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma))
  const events = { emitCompetitionChanged: jest.fn() }
  const service = new CompetitionsService(
    prisma as unknown as PrismaService,
    {} as PlayersService,
    events as unknown as BookingEventsService,
  )
  const createPena = () =>
    service.create(CLUB, 1, {
      kind: CompetitionKind.PENA,
      name: 'Peña de los jueves',
      courtIds: [court.id],
      sessions: [{ dateKey: '2026-10-17', startTime: '20:00', endTime: '23:00' }],
    })
  return { prisma, events, createPena }
}

function slot(band: { startsAt: Date; endsAt: Date }, status: SlotStatus, competitionId: string | null = null) {
  return { id: `slot-${band.startsAt.toISOString()}`, courtId: court.id, ...band, status, competitionId }
}

describe('CompetitionsService court blocking', () => {
  it('creates every overlapping band as BLOCKED, tagged with the event', async () => {
    const { prisma, events, createPena } = setup()
    await createPena()

    const created = prisma.slot.createMany.mock.calls[0][0].data
    expect(created.map((s: { startsAt: Date }) => s.startsAt)).toEqual([
      BAND_1930.startsAt,
      BAND_2100.startsAt,
      BAND_2230.startsAt,
    ])
    expect(
      created.every(
        (s: { status: SlotStatus; competitionId: string }) =>
          s.status === SlotStatus.BLOCKED && s.competitionId === 'comp-1',
      ),
    ).toBe(true)
    expect(events.emitCompetitionChanged).toHaveBeenCalledWith({
      type: 'competition.changed',
      clubId: CLUB,
      competitionId: 'comp-1',
    })
  })

  it('claims an AVAILABLE slot and leaves one blocked for something else alone', async () => {
    const available = slot(BAND_2100, SlotStatus.AVAILABLE)
    const rain = slot(BAND_2230, SlotStatus.BLOCKED)
    const { prisma, createPena } = setup([available, rain])
    await createPena()

    expect(prisma.slot.createMany.mock.calls[0][0].data).toHaveLength(1)
    expect(prisma.slot.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [available.id] }, clubId: CLUB, status: SlotStatus.AVAILABLE },
      data: { status: SlotStatus.BLOCKED, competitionId: 'comp-1' },
    })
    const touchedRain = prisma.slot.updateMany.mock.calls.some(([args]) => args.where.id?.in?.includes(rain.id))
    expect(touchedRain).toBe(false)
  })

  it('refuses the whole event when a turno in the window is booked, naming it', async () => {
    const { prisma, createPena } = setup([slot(BAND_2100, SlotStatus.BOOKED)])
    await expect(createPena()).rejects.toThrow(ConflictException)
    await expect(createPena()).rejects.toThrow('Cancha 1 · sábado 17/10 21:00')
    expect(prisma.slot.createMany).not.toHaveBeenCalled()
  })

  it('frees the turnos it held that no longer fall in the window', async () => {
    const { prisma, createPena } = setup([slot(BAND_1930, SlotStatus.BLOCKED, 'comp-1')])
    await createPena()

    expect(prisma.slot.updateMany).toHaveBeenCalledWith({
      where: { clubId: CLUB, competitionId: 'comp-1', id: { notIn: [`slot-${BAND_1930.startsAt.toISOString()}`] } },
      data: { status: SlotStatus.AVAILABLE, competitionId: null },
    })
    // Still held, so it isn't created again.
    expect(prisma.slot.createMany.mock.calls[0][0].data).toHaveLength(2)
  })
})
