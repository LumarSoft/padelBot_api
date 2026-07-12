import { BotService } from './bot.service'
import { BotState, MyBookingOption, SessionContext } from './types'

/**
 * Moving a booking from WhatsApp.
 *
 * The bot deliberately does NOT cancel. Rescheduling keeps the deposit alive on the same
 * booking, frees the old court for the waitlist to resell, and takes no money out of the club
 * — which is the whole reason a player is allowed to do it alone. A real cancellation moves
 * money, so it stays a decision of the club, in the panel.
 *
 * What these tests pin:
 *  - the club's policy decides whether the player may move it at all (SELF / REQUEST / OFF),
 *  - nothing the bot can't resolve ends in silence: every other path notifies the staff,
 *  - the price difference is stated BEFORE the player commits,
 *  - only an explicit "sí" moves anything.
 */

const WA_ID = '5493411234567'
const CLUB = 'club-1'

const myBookings: MyBookingOption[] = [
  {
    id: 'b1',
    label: 'sábado 18/07 · 18:00–19:30 · Cancha 1',
    short: '18/07 · 18:00',
    courtName: 'Cancha 1',
    pending: false,
  },
]

/** A player who already picked a new (cheaper/equal/dearer) band and is on the confirm step. */
const atConfirm = (newPrice: number, oldPrice = 20000): SessionContext => ({
  rescheduleBookingId: 'b1',
  rescheduleFromLabel: myBookings[0].label,
  rescheduleFromPriceCents: oldPrice,
  selectedDate: '2026-07-19',
  selectedCourtId: 'c1',
  selectedCourtName: 'Cancha 1',
  selectedBandStart: '20:00',
  selectedSlotLabel: '20:00–21:30',
  selectedSlotPrice: newPrice,
})

function setup(policy: Record<string, unknown> | null = { mode: 'SELF', reason: 'ok' }) {
  const bookings = {
    findUpcomingForPlayer: jest.fn().mockResolvedValue([]),
    reschedulePolicyForPlayer: jest.fn().mockResolvedValue(
      policy && {
        cutoffHours: 6,
        startsAt: new Date('2026-07-18T21:00:00Z'),
        courtName: 'Cancha 1',
        priceCents: 20000,
        ...policy,
      },
    ),
    rescheduleToBandByPlayer: jest.fn().mockResolvedValue({ priceDiffCents: 0, newPriceCents: 20000 }),
  }
  const notifications = { notifyClub: jest.fn().mockResolvedValue(undefined) }
  const llm = { handleFallback: jest.fn().mockResolvedValue({ reply: 'llm', state: BotState.MENU, ctx: {} }) }

  const service = new BotService(
    {} as never,
    bookings as never,
    {} as never,
    {} as never,
    llm as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    notifications as never,
  )
  return { service, bookings, notifications, llm }
}

interface HandlerLike {
  reply: string
  prefix?: string
  state: BotState
  ctx: SessionContext
}

const step = (service: BotService, state: BotState, msg: string, ctx: SessionContext) =>
  (
    service as unknown as {
      dispatch: (s: BotState, m: string, c: SessionContext, club: string, wa: string) => Promise<HandlerLike>
    }
  ).dispatch(state, msg, ctx, CLUB, WA_ID)

describe('the club decides what the player may do', () => {
  it('offers to MOVE the booking, never to cancel it', async () => {
    const { service } = setup()

    const result = await step(service, BotState.MY_BOOKINGS, 'turno:b1', { myBookings })

    expect(result.state).toBe(BotState.RESCHEDULE_DATE)
    expect(result.reply).toContain('la seña que pagaste sigue valiendo')
    expect(result.ctx.rescheduleBookingId).toBe('b1')
  })

  it('sends the player to the club when the club handles changes itself (REQUEST)', async () => {
    const { service, bookings, notifications } = setup({ mode: 'REQUEST', reason: 'club-policy' })

    const result = await step(service, BotState.MY_BOOKINGS, 'turno:b1', { myBookings })

    // Nothing moved…
    expect(bookings.rescheduleToBandByPlayer).not.toHaveBeenCalled()
    // …but the staff was told, so the player is never left hanging.
    expect(notifications.notifyClub).toHaveBeenCalledWith(
      CLUB,
      expect.objectContaining({ title: expect.stringContaining('cambiar un turno') }),
    )
    expect(result.reply).toContain('Ya les pasé tu pedido')
    expect(result.state).toBe(BotState.MENU)
  })

  it('hands over to a human when it is too close to the start (cutoff)', async () => {
    const { service, notifications } = setup({ mode: 'REQUEST', reason: 'too-late' })

    const result = await step(service, BotState.MY_BOOKINGS, 'turno:b1', { myBookings })

    expect(result.reply).toContain('falta poco para el turno')
    expect(notifications.notifyClub).toHaveBeenCalled()
  })

  it('hands over to a human when the player already used their move', async () => {
    const { service } = setup({ mode: 'REQUEST', reason: 'limit-reached' })

    const result = await step(service, BotState.MY_BOOKINGS, 'turno:b1', { myBookings })

    expect(result.reply).toContain('Ya moviste este turno una vez')
  })

  it('does not offer it at all when the club turned it off', async () => {
    const { service, notifications } = setup({ mode: 'OFF', reason: 'club-policy' })

    const result = await step(service, BotState.MY_BOOKINGS, 'turno:b1', { myBookings })

    expect(result.reply).toContain('hablá directamente con el club')
    expect(notifications.notifyClub).not.toHaveBeenCalled()
  })
})

describe('the escape hatch', () => {
  it('never traps a player who cannot make ANY other day', async () => {
    const { service, notifications } = setup()

    // Left in the flow with no way out, this player just doesn't show up — which is worse for
    // the club than being told.
    const result = await step(service, BotState.RESCHEDULE_DATE, 'no puedo ningún otro día', {
      rescheduleBookingId: 'b1',
      rescheduleFromLabel: myBookings[0].label,
    })

    expect(notifications.notifyClub).toHaveBeenCalledWith(
      CLUB,
      expect.objectContaining({ body: expect.stringContaining('no le sirve ningún otro día') }),
    )
    expect(result.reply).toContain('Le paso tu caso al club')
    expect(result.state).toBe(BotState.MENU)
  })
})

describe('the price difference is stated before the player commits', () => {
  it('NEVER moves a booking from a question — the LLM may answer, only "sí" moves', async () => {
    const { service, bookings, llm } = setup()

    // "¿y la diferencia?" is a question, not an answer. It reaches the LLM…
    await step(service, BotState.RESCHEDULE_CONFIRM, 'y la diferencia?', atConfirm(30000))

    expect(llm.handleFallback).toHaveBeenCalled()
    // …and whatever the model replies, the booking stays exactly where it was.
    expect(bookings.rescheduleToBandByPlayer).not.toHaveBeenCalled()
  })

  it('confirms a move to a dearer band, difference paid at the club', async () => {
    const { service, bookings } = setup()

    const result = await step(service, BotState.RESCHEDULE_CONFIRM, 'si', atConfirm(30000))

    expect(bookings.rescheduleToBandByPlayer).toHaveBeenCalledWith(CLUB, 'b1', WA_ID, {
      courtId: 'c1',
      dateKey: '2026-07-19',
      bandStart: '20:00',
    })
    expect(result.state).toBe(BotState.MENU)
  })

  it('keeps the booking untouched when the player backs out', async () => {
    const { service, bookings } = setup()

    const result = await step(service, BotState.RESCHEDULE_CONFIRM, 'no', atConfirm(20000))

    expect(bookings.rescheduleToBandByPlayer).not.toHaveBeenCalled()
    expect(result.reply).toContain('te dejé el turno como estaba')
  })

  it('tells the player plainly when the new band was taken meanwhile', async () => {
    const { service, bookings } = setup()
    bookings.rescheduleToBandByPlayer.mockResolvedValue(null)

    const result = await step(service, BotState.RESCHEDULE_CONFIRM, 'si', atConfirm(20000))

    expect(result.reply).toContain('No pude mover el turno')
  })
})
