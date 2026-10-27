import { WaitlistService } from './waitlist.service'
import type { SlotFreedEvent } from '../events/booking-events.service'

/**
 * Lista de espera y reoferta (RF-08).
 *
 * The waitlist never books anything by itself: an entry records interest for a club and a day,
 * and a freed band is *offered* to those entries. The player's "sí" then goes through the
 * ordinary booking flow, whose atomic lock decides who gets the court. These tests pin that
 * contract: one entry per club/phone/day, offers only for future bands of the same club and
 * day, the bot session seeded at the confirm step, and no write on the slot from the offer.
 */

const FUTURE = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)

function freedEvent(startsAt: Date): SlotFreedEvent {
  return {
    type: 'slot.freed',
    clubId: 'club-1',
    courtId: 'court-1',
    courtName: 'Cancha 1',
    startsAt,
    endsAt: new Date(startsAt.getTime() + 90 * 60 * 1000),
    priceCents: 3000000,
  }
}

function setup(
  opts: {
    entries?: { id: string; waId: string; playerName: string | null }[]
    line?: boolean
    botPaused?: boolean
  } = {},
) {
  const prisma = {
    waitlistEntry: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue(opts.entries ?? []),
      update: jest.fn().mockResolvedValue({}),
    },
    whatsAppLine: {
      findFirst: jest.fn().mockResolvedValue(opts.line === false ? null : { phoneNumberId: 'pnid-1' }),
    },
    conversationSession: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    slot: { updateMany: jest.fn(), update: jest.fn(), create: jest.fn() },
    booking: { create: jest.fn() },
  }
  const whatsapp = { sendText: jest.fn().mockResolvedValue(undefined) }
  const events = { all: jest.fn() }
  const plans = { hasFeature: jest.fn().mockResolvedValue(true) }
  const credits = { botPaused: jest.fn().mockResolvedValue(opts.botPaused ?? false) }
  const service = new WaitlistService(
    prisma as never,
    whatsapp as never,
    events as never,
    plans as never,
    credits as never,
  )
  const notify = (e: SlotFreedEvent) =>
    (service as unknown as { notifyFreedSlot: (e: SlotFreedEvent) => Promise<void> }).notifyFreedSlot(e)
  return { service, prisma, whatsapp, notify }
}

describe('WaitlistService.join (CA-17)', () => {
  it('keeps a single entry per club, phone and day: joining twice upserts on that key', async () => {
    const { service, prisma } = setup()

    await service.join('club-1', '5493411234567', '2030-01-04', 'Martínez')
    await service.join('club-1', '5493411234567', '2030-01-04')

    for (const call of prisma.waitlistEntry.upsert.mock.calls as unknown[][]) {
      expect((call[0] as { where: unknown }).where).toEqual({
        clubId_waId_dateKey: { clubId: 'club-1', waId: '5493411234567', dateKey: '2030-01-04' },
      })
    }
    // A second join without a name must not erase the name given before.
    expect((prisma.waitlistEntry.upsert.mock.calls[1] as unknown[])[0]).toMatchObject({ update: {} })
  })
})

describe('WaitlistService — reoferta de la banda liberada (CA-18)', () => {
  it('offers a future freed band to the entries of the same club and day, without touching the slot', async () => {
    const { prisma, whatsapp, notify } = setup({
      entries: [
        { id: 'w1', waId: '5493410000001', playerName: 'Ana' },
        { id: 'w2', waId: '5493410000002', playerName: null },
      ],
    })

    await notify(freedEvent(FUTURE))

    const query = (prisma.waitlistEntry.findMany.mock.calls[0] as unknown[])[0] as {
      where: { clubId: string; dateKey: string }
      take: number
    }
    expect(query.where.clubId).toBe('club-1')
    expect(query.where.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(query.take).toBe(10)

    expect(whatsapp.sendText).toHaveBeenCalledTimes(2)
    expect(prisma.waitlistEntry.update).toHaveBeenCalledTimes(2) // notifiedAt per notified entry

    // The player with a name enters at the confirm step; without a name, at the name question.
    const states = (prisma.conversationSession.upsert.mock.calls as unknown[][]).map(
      c => (c[0] as { create: { state: string } }).create.state,
    )
    expect(states).toEqual(['BOOK_CONFIRM', 'BOOK_NAME'])

    // The offer is not a hold: nothing is written on the slot or the bookings.
    expect(prisma.slot.updateMany).not.toHaveBeenCalled()
    expect(prisma.slot.update).not.toHaveBeenCalled()
    expect(prisma.booking.create).not.toHaveBeenCalled()
  })

  it('never offers a band that already started', async () => {
    const { prisma, whatsapp, notify } = setup({ entries: [{ id: 'w1', waId: '549341', playerName: 'Ana' }] })

    await notify(freedEvent(new Date(Date.now() - 60 * 1000)))

    expect(prisma.waitlistEntry.findMany).not.toHaveBeenCalled()
    expect(whatsapp.sendText).not.toHaveBeenCalled()
  })

  it('does not send anything when the club has no active WhatsApp line', async () => {
    const { whatsapp, prisma, notify } = setup({
      entries: [{ id: 'w1', waId: '549341', playerName: 'Ana' }],
      line: false,
    })

    await notify(freedEvent(FUTURE))

    expect(whatsapp.sendText).not.toHaveBeenCalled()
    expect(prisma.waitlistEntry.update).not.toHaveBeenCalled()
  })

  it('stays silent while the bot is paused for lack of credits: the band remains on the agenda', async () => {
    const { whatsapp, prisma, notify } = setup({
      entries: [{ id: 'w1', waId: '549341', playerName: 'Ana' }],
      botPaused: true,
    })

    await notify(freedEvent(FUTURE))

    expect(whatsapp.sendText).not.toHaveBeenCalled()
    expect(prisma.waitlistEntry.update).not.toHaveBeenCalled()
    expect(prisma.slot.updateMany).not.toHaveBeenCalled()
  })

  it('a failed send to one player does not stop the offer to the rest, and is not marked notified', async () => {
    const { whatsapp, prisma, notify } = setup({
      entries: [
        { id: 'w1', waId: '5493410000001', playerName: 'Ana' },
        { id: 'w2', waId: '5493410000002', playerName: 'Bruno' },
      ],
    })
    whatsapp.sendText.mockRejectedValueOnce(new Error('meta down'))

    await notify(freedEvent(FUTURE))

    expect(whatsapp.sendText).toHaveBeenCalledTimes(2)
    expect(prisma.waitlistEntry.update).toHaveBeenCalledTimes(1)
    expect(prisma.waitlistEntry.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'w2' } }))
  })
})
