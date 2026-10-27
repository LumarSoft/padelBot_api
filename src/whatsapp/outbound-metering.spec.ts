import { notifyOps } from '../common/ops-alert'
import { WhatsAppService } from './whatsapp.service'

jest.mock('../common/ops-alert', () => ({ notifyOps: jest.fn().mockResolvedValue(undefined) }))

function setup(response: { ok: boolean; status?: number; body?: string }) {
  const credits = { recordSent: jest.fn().mockResolvedValue(undefined) }
  const prisma = {
    whatsAppLine: {
      findUnique: jest.fn().mockResolvedValue({ displayPhone: '+54 9 341 555-0000', club: { name: 'Padel Norte' } }),
    },
  }
  const lines = { findAccessToken: jest.fn().mockResolvedValue(null) }
  const service = new WhatsAppService(prisma as never, lines as never, credits as never)
  global.fetch = jest.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    text: async () => response.body ?? '',
  }) as never
  return { service, credits }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

/**
 * Every message Graph accepts is metered: the bot's are the club's credits, the staff's and
 * templates go to our Meta cost. A send Meta refuses for payment leaves the bot mute, so ops hears.
 */
describe('WhatsAppService outbound metering', () => {
  beforeEach(() => jest.mocked(notifyOps).mockClear())

  it('records a bot reply, a staff reply and a template under their own kind', async () => {
    const { service, credits } = setup({ ok: true })

    await service.sendText('phone-1', '5493415550000', 'Hola')
    await service.sendText('phone-1', '5493415550000', 'Te escribe Juan del club', 'staff')
    await service.sendTemplate('phone-1', '5493415550000', 'recordatorio', 'es_AR', ['20:00'])

    expect(credits.recordSent.mock.calls).toEqual([
      ['phone-1', 'botService'],
      ['phone-1', 'staffService'],
      ['phone-1', 'utility'],
    ])
  })

  it('records nothing for a message Graph refused', async () => {
    const { service, credits } = setup({ ok: false, status: 400, body: '{"error":{"code":100}}' })

    expect(await service.sendText('phone-1', '5493415550000', 'Hola')).toBe(false)
    expect(credits.recordSent).not.toHaveBeenCalled()
  })

  it('alerts ops once when Meta refuses for payment (131042)', async () => {
    const { service } = setup({
      ok: false,
      status: 400,
      body: '{"error":{"code":131042,"message":"Business eligibility payment issue"}}',
    })

    await service.sendText('phone-1', '5493415550000', 'Hola')
    await service.sendText('phone-1', '5493415550000', 'Hola de nuevo')
    await flush()

    expect(notifyOps).toHaveBeenCalledTimes(1)
    expect(jest.mocked(notifyOps).mock.calls[0][0]).toMatch(/Padel Norte.*problema de pago.*131042/)
  })
})
