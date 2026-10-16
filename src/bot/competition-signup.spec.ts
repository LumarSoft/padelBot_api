import { BotService } from './bot.service'
import { BotState, HandlerResult, SessionContext } from './types'

/**
 * Torneos y peñas through the bot: "3" (or "¿hay algún torneo?") lists the events open for
 * registration; picking one records the request, tells the club and hands the chat to a person
 * ("Pide asesor"). The bot never registers anybody itself.
 */

const CLUB = 'club-1'
const WA_ID = '5493411111111'

const open = [
  {
    id: 'c1',
    kind: 'TOURNAMENT' as const,
    name: 'Torneo Primavera',
    entryFeeCents: 1_000_000,
    dateKey: '2026-10-24',
    startTime: '09:00',
    sessionCount: 1,
    categories: ['4ta'],
  },
]

function setup(request: unknown = { competitionName: 'Torneo Primavera', alreadyPending: false }) {
  const sessionService = { requestAdvisor: jest.fn() }
  const competitionSignups = {
    openForPlayers: jest.fn().mockResolvedValue(open),
    request: jest.fn().mockResolvedValue(request),
  }
  const prisma = { conversationSession: { findUnique: jest.fn().mockResolvedValue({ id: 'session-1' }) } }
  const service = new BotService(
    prisma as never,
    {} as never, // bookings
    {} as never, // availability
    sessionService as never,
    {} as never, // llm
    {} as never, // media
    {} as never, // receiptStorage
    {} as never, // waitlist
    {} as never, // players
    {} as never, // notifications
    {} as never, // credits
    competitionSignups as never,
  )
  const internals = service as unknown as {
    onMenu: (msg: string, ctx: SessionContext, clubId: string, waId: string) => Promise<HandlerResult>
    onCompetitionPick: (msg: string, ctx: SessionContext, clubId: string, waId: string) => Promise<HandlerResult>
  }
  return { internals, sessionService, competitionSignups }
}

describe('torneos y peñas in the bot', () => {
  it('lists the open events from the menu option 3', async () => {
    const { internals } = setup()
    const result = await internals.onMenu('3', {}, CLUB, WA_ID)
    expect(result.state).toBe(BotState.COMPETITION_PICK)
    expect(result.reply).toContain('Torneo Primavera')
    expect(result.ctx.competitionOptions?.[0].id).toBe('c1')
  })

  it('understands asking for tournaments in words, without the LLM', async () => {
    const { internals, competitionSignups } = setup()
    const result = await internals.onMenu('hola, ¿hay algún torneo este mes?', {}, CLUB, WA_ID)
    expect(competitionSignups.openForPlayers).toHaveBeenCalledWith(CLUB)
    expect(result.state).toBe(BotState.COMPETITION_PICK)
  })

  it('records the request, hands the chat to a person and tells the player', async () => {
    const { internals, sessionService, competitionSignups } = setup()
    const listed = await internals.onMenu('3', { playerName: 'Juan' }, CLUB, WA_ID)
    const result = await internals.onCompetitionPick('torneo:c1', listed.ctx, CLUB, WA_ID)

    expect(competitionSignups.request).toHaveBeenCalledWith(CLUB, {
      competitionId: 'c1',
      waId: WA_ID,
      playerName: 'Juan',
    })
    expect(sessionService.requestAdvisor).toHaveBeenCalledWith('session-1')
    expect(result.state).toBe(BotState.MENU)
    expect(result.reply).toContain('te querés anotar a *Torneo Primavera*')
    expect(result.ctx.competitionOptions).toBeUndefined()
  })

  it('says so and re-lists when the event closed in the meantime', async () => {
    const { internals, sessionService } = setup(null)
    const listed = await internals.onMenu('3', {}, CLUB, WA_ID)
    const result = await internals.onCompetitionPick('1', listed.ctx, CLUB, WA_ID)

    expect(sessionService.requestAdvisor).not.toHaveBeenCalled()
    expect(result.prefix).toContain('ya no tiene la inscripción abierta')
    expect(result.state).toBe(BotState.COMPETITION_PICK)
  })
})
