import OpenAI from 'openai'
import { notifyOps } from '../common/ops-alert'
import { BotState } from '../bot/types'
import { NOT_UNDERSTOOD } from '../bot/messages'
import { LlmService } from './llm.service'

jest.mock('../common/ops-alert', () => ({ notifyOps: jest.fn().mockResolvedValue(undefined) }))

/** What the SDK throws for an HTTP error: `code` comes from the body's `error.code`. */
const openAiError = (status: number, code: string) =>
  new OpenAI.APIError(status, { code, type: code, message: `${code} from OpenAI` }, undefined, new Headers())

const NO_CREDIT = openAiError(429, 'insufficient_quota')
const BAD_KEY = openAiError(401, 'invalid_api_key')

function setup(error: unknown) {
  process.env.OPENAI_API_KEY ??= 'test-key'
  const prisma = {
    club: { findUnique: jest.fn().mockResolvedValue(null) },
    court: { findMany: jest.fn().mockResolvedValue([]) },
    product: { findMany: jest.fn().mockResolvedValue([]) },
  }
  const service = new LlmService(prisma as never, {} as never, {} as never)
  const create = jest.fn().mockRejectedValue(error)
  const openai = { audio: { transcriptions: { create } }, chat: { completions: { create } } }
  ;(service as unknown as { openai: typeof openai }).openai = openai
  return { service, create }
}

/** The alert is fire-and-forget: let it run before asserting. */
const flush = () => new Promise(resolve => setImmediate(resolve))

const audio = Buffer.from('fake-ogg')
const image = Buffer.from('fake-jpg')

/**
 * OpenAI is prepaid: when the credit runs out (or the key is revoked) every AI step fails and the
 * bot only degrades quietly — "no entendí", unread audios and receipts. Ops hears before the clubs.
 */
describe('OpenAI account failure alert', () => {
  beforeEach(() => jest.mocked(notifyOps).mockClear())
  afterEach(() => jest.restoreAllMocks())

  it('alerts ops once when OpenAI has no credit left, and the player sees the same as before', async () => {
    const { service } = setup(NO_CREDIT)

    const reply = await service.handleFallback(BotState.MENU, 'tienen paletas?', {}, 'club-1', '5493411111111')
    expect(await service.transcribeAudio('club-1', '5493411111111', audio, 'audio/ogg')).toBeNull()
    expect(await service.readTransferReceipt('club-2', '5493412222222', image, 'image/jpeg')).toBeNull()
    expect(await service.describeImage('club-3', '5493413333333', image, 'image/jpeg')).toBeNull()
    await flush()

    expect([reply.prefix, reply.reply]).toContain(NOT_UNDERSTOOD)
    expect(notifyOps).toHaveBeenCalledTimes(1)
    expect(jest.mocked(notifyOps).mock.calls[0][0]).toMatch(
      /falta de saldo.*platform\.openai\.com \(Billing\).*429 insufficient_quota/,
    )
  })

  it('alerts again an hour later if it still has no credit', async () => {
    const { service } = setup(NO_CREDIT)
    const now = Date.now()
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now)

    await service.transcribeAudio('club-1', '5493411111111', audio, 'audio/ogg')
    clock.mockReturnValue(now + 59 * 60 * 1000)
    await service.transcribeAudio('club-1', '5493411111111', audio, 'audio/ogg')
    clock.mockReturnValue(now + 61 * 60 * 1000)
    await service.transcribeAudio('club-1', '5493411111111', audio, 'audio/ogg')
    await flush()

    expect(notifyOps).toHaveBeenCalledTimes(2)
  })

  it('alerts a rejected key on its own, also once', async () => {
    const { service, create } = setup(NO_CREDIT)

    await service.describeImage('club-1', '5493411111111', image, 'image/jpeg')
    create.mockRejectedValue(BAD_KEY)
    await service.describeImage('club-1', '5493411111111', image, 'image/jpeg')
    await service.readTransferReceipt('club-1', '5493411111111', image, 'image/jpeg')
    await flush()

    expect(notifyOps).toHaveBeenCalledTimes(2)
    expect(jest.mocked(notifyOps).mock.calls[1][0]).toMatch(/clave.*OPENAI_API_KEY.*401 invalid_api_key/)
  })

  it('stays quiet on failures that pass on their own', async () => {
    for (const error of [
      openAiError(429, 'rate_limit_exceeded'),
      openAiError(500, 'server_error'),
      new Error('boom'),
    ]) {
      const { service } = setup(error)
      await service.transcribeAudio('club-1', '5493411111111', audio, 'audio/ogg')
    }
    await flush()

    expect(notifyOps).not.toHaveBeenCalled()
  })
})
