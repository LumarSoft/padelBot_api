import { LlmService } from './llm.service'

/**
 * One AI credit = one AI step. The landing tells clubs "cada vez que el bot entiende un mensaje,
 * escucha un audio o lee un comprobante, usa créditos de IA", so each of those must land in the
 * club's `LlmUsageDaily.calls` — not only the chat calls, which were the only ones counted.
 */
function setup() {
  process.env.OPENAI_API_KEY ??= 'test-key'
  const upsert = jest.fn().mockResolvedValue({})
  const service = new LlmService({ llmUsageDaily: { upsert } } as never, {} as never)
  const openai = {
    audio: {
      transcriptions: {
        create: jest.fn().mockResolvedValue({
          text: 'quiero reservar el sábado',
          usage: { type: 'tokens', input_tokens: 600, output_tokens: 20, total_tokens: 620 },
        }),
      },
    },
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: '{"isTransferReceipt":true,"amount":5000}' } }],
          usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 },
        }),
      },
    },
  }
  ;(service as unknown as { openai: typeof openai }).openai = openai
  return { service, upsert }
}

/** recordUsage is fire-and-forget: let it run before asserting. */
const flush = () => new Promise(resolve => setImmediate(resolve))

function expectOneCredit(upsert: jest.Mock, clubId: string) {
  expect(upsert).toHaveBeenCalledTimes(1)
  const [args] = upsert.mock.calls[0] as [
    { where: { clubId_dateKey: { clubId: string } }; create: { calls: number }; update: { calls: unknown } },
  ]
  expect(args.where.clubId_dateKey.clubId).toBe(clubId)
  expect(args.create.calls).toBe(1)
  expect(args.update.calls).toEqual({ increment: 1 })
}

describe('AI credit metering', () => {
  const audio = Buffer.from('fake-ogg')
  const image = Buffer.from('fake-jpg')

  it('counts a transcribed audio as one credit of its club', async () => {
    const { service, upsert } = setup()

    await service.transcribeAudio('club-1', '5493411111111', audio, 'audio/ogg')
    await flush()

    expectOneCredit(upsert, 'club-1')
    // Priced from the audio tokens, so the ops cost column sees it too.
    const [args] = upsert.mock.calls[0] as [{ create: { costMicroUsd: number } }]
    expect(args.create.costMicroUsd).toBeGreaterThan(0)
  })

  it('counts a read receipt as one credit', async () => {
    const { service, upsert } = setup()

    await service.readTransferReceipt('club-2', '5493412222222', image, 'image/jpeg')
    await flush()

    expectOneCredit(upsert, 'club-2')
  })

  it('counts a described image as one credit', async () => {
    const { service, upsert } = setup()

    await service.describeImage('club-3', '5493413333333', image, 'image/jpeg')
    await flush()

    expectOneCredit(upsert, 'club-3')
  })

  it('charges nothing when the player is rate limited and no AI runs', async () => {
    const { service, upsert } = setup()
    const waId = '5493414444444'
    ;(service as unknown as { llmCalls: Map<string, number[]> }).llmCalls.set(
      waId,
      Array.from({ length: 50 }, () => Date.now()),
    )

    expect(await service.transcribeAudio('club-1', waId, audio, 'audio/ogg')).toBeNull()
    await flush()

    expect(upsert).not.toHaveBeenCalled()
  })
})
