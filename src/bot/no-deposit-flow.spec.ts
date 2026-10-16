import { BotService } from './bot.service'
import { ATTACHMENT_NO_DEPOSIT, PAYMENT_UNAVAILABLE } from './messages'
import { BotState, MyBookingOption, SessionContext } from './types'
import { NoShowReviewRequiredException } from '../bookings/bookings.service'

/**
 * The bot as a booking book ("sin seña", DepositMode.NONE).
 *
 * Name, day, time → "¡Listo, reserva confirmada!". No alias, no amount, no 30-minute countdown,
 * and nothing in the chat afterwards may talk as if a transfer were on its way.
 */

const WA_ID = '5493411234567'
const CLUB = 'club-1'

/** A player one "sí" away from booking Saturday 18:00 on Cancha 1. */
const atConfirm: SessionContext = {
  playerName: 'Martínez',
  selectedDate: '2026-10-17',
  selectedCourtId: 'c1',
  selectedCourtName: 'Cancha 1',
  selectedBandStart: '18:00',
  selectedSlotLabel: '18:00 - 19:30',
  selectedSlotPrice: 2400000,
}

const NONE_CLUB = {
  transferAlias: null,
  transferHolder: null,
  depositMode: 'NONE',
  requireDniMatch: true,
  paymentVerificationMode: 'AUTO',
}

const CONFIRMED = {
  id: 'b1',
  depositCents: 0,
  transferAmountCents: 0,
  creditAppliedCents: 0,
  confirmedByCredit: false,
  confirmedWithoutDeposit: true,
}

function setup(club: Record<string, unknown> = NONE_CLUB) {
  const bookings = {
    bookBandPending: jest.fn().mockResolvedValue(CONFIRMED),
    bookPending: jest.fn().mockResolvedValue(CONFIRMED),
    findKnownDniForPhone: jest.fn().mockResolvedValue('30111222'),
    findActivePendingForPlayer: jest.fn().mockResolvedValue(null),
    reschedulePolicyForPlayer: jest.fn(),
  }
  const prisma = {
    club: {
      findUnique: jest.fn().mockResolvedValue({ ...club, paymentVerificationMode: club.paymentVerificationMode }),
    },
  }
  const notifications = { notifyClub: jest.fn().mockResolvedValue(undefined) }
  const llm = { handleFallback: jest.fn().mockResolvedValue({ reply: 'llm', state: BotState.MENU, ctx: {} }) }
  const service = new BotService(
    prisma as never,
    bookings as never,
    {} as never,
    {} as never,
    llm as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    notifications as never,
    { botPaused: jest.fn().mockResolvedValue(false) } as never, // credits,
    {} as never, // competitionSignups
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

describe('confirming a booking at a club without seña', () => {
  it('books it without an alias configured — there is nothing to pay', async () => {
    const { service, bookings } = setup()

    const result = await step(service, BotState.BOOK_CONFIRM, 'si', atConfirm)

    expect(bookings.bookBandPending).toHaveBeenCalledWith(
      CLUB,
      expect.objectContaining({ courtId: 'c1', dateKey: '2026-10-17', bandStart: '18:00', playerName: 'Martínez' }),
    )
    expect(result.reply).not.toBe(PAYMENT_UNAVAILABLE)
  })

  it('answers "reserva confirmada" with the booking — no alias, no amount, no countdown', async () => {
    const { service } = setup()

    const result = await step(service, BotState.BOOK_CONFIRM, 'si', atConfirm)

    expect(result.state).toBe(BotState.MENU)
    expect(result.reply).toContain('reserva confirmada')
    expect(result.reply).toContain('Cancha 1')
    expect(result.reply).toContain('18:00 - 19:30')
    expect(result.reply).toContain('Martínez')
    expect(result.reply).toContain('se abona en el club')
    expect(result.reply).not.toMatch(/alias|transfer|30 minutos|seña/i)
    // The flow is over: only the name survives for the next booking.
    expect(result.ctx).toEqual({ playerName: 'Martínez' })
  })

  it('never asks for — or reuses — a DNI: there is no payer to identify', async () => {
    const { service, bookings } = setup()

    await step(service, BotState.BOOK_CONFIRM, 'si', atConfirm)

    expect(bookings.findKnownDniForPhone).not.toHaveBeenCalled()
    expect(bookings.bookBandPending).toHaveBeenCalledWith(CLUB, expect.objectContaining({ playerDni: undefined }))
  })

  it('still refuses a club that charges a seña but has nowhere to send the player', async () => {
    const { service, bookings } = setup({ ...NONE_CLUB, depositMode: 'DEPOSIT' })

    const result = await step(service, BotState.BOOK_CONFIRM, 'si', atConfirm)

    expect(result.reply).toBe(PAYMENT_UNAVAILABLE)
    expect(bookings.bookBandPending).not.toHaveBeenCalled()
  })

  it('confirms the same way when a priced club books a court with no price ($0 seña)', async () => {
    const { service, bookings } = setup({ ...NONE_CLUB, depositMode: 'DEPOSIT', transferAlias: 'club.mp' })
    bookings.bookBandPending.mockResolvedValue(CONFIRMED)

    const result = await step(service, BotState.BOOK_CONFIRM, 'si', { ...atConfirm, selectedSlotPrice: 0 })

    expect(result.reply).toContain('reserva confirmada')
    expect(result.reply).not.toContain('club.mp')
    // No price to quote at the desk either.
    expect(result.reply).not.toContain('se abona en el club')
  })
})

describe('a player with too many no-shows, without a seña to ask', () => {
  it('hands the booking to a person of the club and says so', async () => {
    const { service, bookings, notifications } = setup()
    bookings.bookBandPending.mockRejectedValue(new NoShowReviewRequiredException(3))

    const result = await step(service, BotState.BOOK_CONFIRM, 'si', atConfirm)

    expect(notifications.notifyClub).toHaveBeenCalledWith(
      CLUB,
      expect.objectContaining({
        title: expect.stringContaining('Reserva para revisar'),
        body: expect.stringMatching(/Martínez \(3 ausencias\).*17\/10.*18:00 - 19:30.*Cancha 1.*5493411234567/),
      }),
    )
    expect(result.reply).toContain('alguien del club')
    expect(result.reply).toContain('te responden por acá')
    expect(result.state).toBe(BotState.MENU)
  })
})

describe('nothing after the booking talks about a transfer', () => {
  it('lets "¿hay que transferir algo?" reach the normal flow instead of "no veo tu pago"', async () => {
    const { service } = setup()
    const claim = (
      service as unknown as {
        paymentClaimReply: (c: string, w: string, ctx: SessionContext) => Promise<HandlerLike | null>
      }
    ).paymentClaimReply.bind(service)

    await expect(claim(CLUB, WA_ID, { playerName: 'Martínez' })).resolves.toBeNull()
  })

  it('still answers a payment claim at a priced club', async () => {
    const { service } = setup({ ...NONE_CLUB, depositMode: 'DEPOSIT', transferAlias: 'club.mp' })
    const claim = (
      service as unknown as {
        paymentClaimReply: (c: string, w: string, ctx: SessionContext) => Promise<HandlerLike | null>
      }
    ).paymentClaimReply.bind(service)

    const result = await claim(CLUB, WA_ID, {})
    expect(result?.reply).toContain('no me figura ninguna reserva tuya esperando pago')
  })

  it('does not promise to "confirm solo" an image that is not a receipt of anything', async () => {
    const { service } = setup()
    const sessionService = {
      getOrCreate: jest.fn().mockResolvedValue({ id: 's1', mode: 'AI', humanUntil: null }),
      saveMessage: jest.fn().mockResolvedValue(undefined),
    }
    Object.assign(service as unknown as Record<string, unknown>, {
      sessionService,
      subscriptionBlockedReply: jest.fn().mockResolvedValue(null),
      replyToImage: jest.fn().mockResolvedValue(null),
    })

    const reply = await service.handleAttachment(WA_ID, CLUB, {
      mediaId: 'm1',
      mimeType: 'image/jpeg',
      phoneNumberId: 'p1',
    } as never)

    expect(reply?.text).toBe(ATTACHMENT_NO_DEPOSIT)
  })
})

describe('moving a booking that never had a seña', () => {
  const myBookings: MyBookingOption[] = [
    {
      id: 'b1',
      label: 'sábado 17/10 · 18:00–19:30 · Cancha 1',
      short: '17/10 · 18:00',
      bandStart: '18:00',
      courtName: 'Cancha 1',
      pending: false,
    },
  ]
  const policy = (carriesDeposit: boolean) => ({
    mode: 'SELF',
    reason: 'ok',
    cutoffHours: 6,
    startsAt: new Date('2026-10-17T21:00:00Z'),
    courtName: 'Cancha 1',
    priceCents: 2400000,
    carriesDeposit,
  })

  it('offers the move without promising "la seña que pagaste sigue valiendo"', async () => {
    const { service, bookings } = setup()
    bookings.reschedulePolicyForPlayer.mockResolvedValue(policy(false))

    const result = await step(service, BotState.MY_BOOKINGS, 'turno:b1', { myBookings })

    expect(result.state).toBe(BotState.RESCHEDULE_DATE)
    expect(result.reply).toContain('te lo paso a otro horario')
    expect(result.reply).not.toContain('seña')
    expect(result.ctx.rescheduleCarriesDeposit).toBe(false)
  })

  it('keeps the seña wording for a booking that paid one', async () => {
    const { service, bookings } = setup()
    bookings.reschedulePolicyForPlayer.mockResolvedValue(policy(true))

    const result = await step(service, BotState.MY_BOOKINGS, 'turno:b1', { myBookings })

    expect(result.reply).toContain('la seña que pagaste sigue valiendo')
  })
})
