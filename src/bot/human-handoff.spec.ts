import { BotService } from './bot.service'
import { BotReply } from './types'

/**
 * "Quiero hablar con una persona" — an explicit request for a human.
 *
 * The bot must not keep answering someone who asked to get past it: it silences itself
 * (mode → HUMAN), pushes the staff so a person actually picks the chat up on this same
 * WhatsApp, and reassures the player. Nothing here ends in silence.
 */

const WA_ID = '5493411234567'
const CLUB = 'club-1'

function setup() {
  const sessionService = {
    setMode: jest.fn().mockResolvedValue(undefined),
    saveMessage: jest.fn().mockResolvedValue(undefined),
  }
  const notifications = { notifyClub: jest.fn().mockResolvedValue(undefined) }

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
    notifications as never,
  )
  return { service, sessionService, notifications }
}

const handoff = (service: BotService) =>
  (
    service as unknown as {
      handoffToHuman: (sessionId: string, waId: string, clubId: string) => Promise<BotReply>
    }
  ).handoffToHuman('session-1', WA_ID, CLUB)

describe('explicit human hand-off', () => {
  it('flips the chat to HUMAN so the bot goes quiet', async () => {
    const { service, sessionService } = setup()
    await handoff(service)
    expect(sessionService.setMode).toHaveBeenCalledWith('session-1', 'HUMAN')
  })

  it('pushes the staff to pick it up on this chat', async () => {
    const { service, notifications } = setup()
    await handoff(service)
    expect(notifications.notifyClub).toHaveBeenCalledWith(
      CLUB,
      expect.objectContaining({ body: expect.stringContaining(WA_ID) }),
    )
  })

  it('reassures the player instead of leaving them in visto', async () => {
    const { service, sessionService } = setup()
    const reply = await handoff(service)
    expect(reply.text).toContain('equipo del club')
    expect(sessionService.saveMessage).toHaveBeenCalledWith('session-1', 'BOT', reply.text)
  })
})
