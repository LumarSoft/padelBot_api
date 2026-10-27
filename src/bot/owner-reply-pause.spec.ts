import { BotService } from './bot.service'
import { SessionSnapshot } from './conversation-session.service'
import { toWaId } from '../whatsapp/whatsapp.controller'

/**
 * Coexistence: the club keeps answering from its WhatsApp Business app. When it replies by
 * hand, the bot must step aside on that chat (temporarily) instead of talking over the owner,
 * and take the chat back once the pause runs out.
 */

const WA_ID = '5493411234567'
const CLUB = 'club-1'
const HOUR = 60 * 60 * 1000

function setup(session: Partial<SessionSnapshot> = {}) {
  const snapshot: SessionSnapshot = {
    id: 'session-1',
    state: 'IDLE',
    mode: 'AI',
    humanUntil: null,
    context: {},
    ...session,
  }
  const sessionService = {
    getOrCreate: jest.fn().mockResolvedValue(snapshot),
    setMode: jest.fn().mockResolvedValue(undefined),
    saveMessage: jest.fn().mockResolvedValue(undefined),
  }
  const service = new BotService(
    {} as never, // prisma
    {} as never, // bookings
    {} as never, // availability
    sessionService as never,
    {} as never, // llm
    {} as never, // media
    {} as never, // receiptStorage
    {} as never, // waitlist
    {} as never, // players
    {} as never, // notifications
    { botPaused: jest.fn().mockResolvedValue(false) } as never, // credits,
    {} as never, // competitionSignups
  )
  return { service, sessionService, snapshot }
}

const isHumanHandled = (service: BotService, session: SessionSnapshot) =>
  (service as unknown as { isHumanHandled: (s: SessionSnapshot, waId: string) => Promise<boolean> }).isHumanHandled(
    session,
    WA_ID,
  )

describe('owner reply from the phone (coexistence echo)', () => {
  it('logs the reply in the chat and pauses the bot for a few hours', async () => {
    const { service, sessionService } = setup()
    const before = Date.now()
    await service.recordOwnerReply(WA_ID, CLUB, 'Hola! te reservo yo')

    expect(sessionService.saveMessage).toHaveBeenCalledWith('session-1', 'ADMIN', 'Hola! te reservo yo')
    const [, mode, until] = sessionService.setMode.mock.calls[0] as [string, string, Date]
    expect(mode).toBe('HUMAN')
    expect(until.getTime()).toBeGreaterThanOrEqual(before + 6 * HOUR)
  })

  it('never turns an indefinite panel takeover into a temporary one', async () => {
    const { service, sessionService } = setup({ mode: 'HUMAN', humanUntil: null })
    await service.recordOwnerReply(WA_ID, CLUB, 'ok')
    expect(sessionService.setMode).not.toHaveBeenCalled()
  })

  it('keeps the bot quiet while the pause is running', async () => {
    const { service, sessionService, snapshot } = setup({ mode: 'HUMAN', humanUntil: new Date(Date.now() + HOUR) })
    await expect(isHumanHandled(service, snapshot)).resolves.toBe(true)
    expect(sessionService.setMode).not.toHaveBeenCalled()
  })

  it('takes the chat back once the pause ran out', async () => {
    const { service, sessionService, snapshot } = setup({ mode: 'HUMAN', humanUntil: new Date(Date.now() - 1) })
    await expect(isHumanHandled(service, snapshot)).resolves.toBe(false)
    expect(sessionService.setMode).toHaveBeenCalledWith('session-1', 'AI')
  })
})

describe('echo recipient → wa_id', () => {
  it('adds the Argentine mobile 9 so it matches the inbound session', () => {
    expect(toWaId('543411234567')).toBe('5493411234567')
    expect(toWaId('+54 9 341 123-4567')).toBe('5493411234567')
  })

  it('leaves other numbers untouched', () => {
    expect(toWaId('15556780421')).toBe('15556780421')
    expect(toWaId(undefined)).toBeUndefined()
  })
})
