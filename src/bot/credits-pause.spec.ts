import { BotService } from './bot.service'

/**
 * The club used up its month's credits: the bot is paused. The player's messages still reach
 * the staff (Conversaciones), the player is told once that the club answers by hand, and the
 * staff is pushed to pick it up — the bot itself says nothing else.
 */

const WA_ID = '5493411234567'
const CLUB = 'club-1'

function setup(opts: { paused: boolean; notified?: boolean; mode?: string }) {
  const sessionService = {
    getOrCreate: jest.fn().mockResolvedValue({
      id: 'session-1',
      state: 'MENU',
      mode: opts.mode ?? 'AI',
      humanUntil: null,
      context: { playerName: 'Lucas', ...(opts.notified ? { creditsPausedNotified: true } : {}) },
    }),
    saveMessage: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
  }
  const prisma = {
    // Subscription active (the bot is allowed), then the club's name for the notice.
    club: {
      findUnique: jest.fn().mockResolvedValue({
        name: 'Padel Norte',
        subscriptionStatus: 'ACTIVE',
        plan: 'saque',
        trialEndsAt: null,
        currentPeriodEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      }),
    },
  }
  const notifications = { notifyClub: jest.fn().mockResolvedValue(undefined) }
  const llm = { interpret: jest.fn() }
  const service = new BotService(
    prisma as never,
    {} as never, // bookings
    {} as never, // availability
    sessionService as never,
    llm as never,
    {} as never, // media
    {} as never, // receiptStorage
    {} as never, // waitlist
    {} as never, // players
    notifications as never,
    { botPaused: jest.fn().mockResolvedValue(opts.paused) } as never,
    {} as never, // competitionSignups
  )
  return { service, sessionService, notifications, llm }
}

describe('the bot paused for credits', () => {
  it('keeps the message for the staff, tells the player the club answers, and pushes the staff', async () => {
    const { service, sessionService, notifications } = setup({ paused: true })

    const reply = await service.handleMessage(WA_ID, CLUB, 'hola, ¿hay cancha mañana?')

    expect(sessionService.saveMessage).toHaveBeenCalledWith('session-1', 'USER', 'hola, ¿hay cancha mañana?')
    expect(reply?.text).toContain('las responde el equipo del club')
    expect(reply?.text).not.toMatch(/cr[ée]dito|plan/i)
    expect(sessionService.update).toHaveBeenCalledWith(
      'session-1',
      'MENU',
      expect.objectContaining({ playerName: 'Lucas', creditsPausedNotified: true }),
    )
    expect(notifications.notifyClub).toHaveBeenCalledWith(
      CLUB,
      expect.objectContaining({ body: expect.stringContaining(WA_ID) }),
    )
  })

  it('stays quiet after telling the player once in the conversation', async () => {
    const { service, sessionService, notifications } = setup({ paused: true, notified: true })

    const reply = await service.handleMessage(WA_ID, CLUB, '¿me responden?')

    expect(reply).toBeNull()
    expect(sessionService.saveMessage).toHaveBeenCalledWith('session-1', 'USER', '¿me responden?')
    expect(notifications.notifyClub).not.toHaveBeenCalled()
  })

  it('stays quiet in a chat the staff already took over', async () => {
    const { service } = setup({ paused: true, mode: 'HUMAN' })

    await expect(service.handleMessage(WA_ID, CLUB, 'hola')).resolves.toBeNull()
  })
})
