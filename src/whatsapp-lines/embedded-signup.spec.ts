import { BadGatewayException, ConflictException } from '@nestjs/common'
import { WhatsAppLinesService } from './whatsapp-lines.service'

/**
 * Embedded Signup finish: exchange the code, subscribe the app, then register (Cloud API) or
 * sync (coexistence) — and never touch a number that is already live or someone else's.
 */

const CLUB = 'club-1'
const WABA = '111'
const PHONE = '222'

type Route = { status?: number; body: unknown }

function mockGraph(routes: Record<string, Route>) {
  const calls: { method: string; url: string; body?: unknown }[] = []
  global.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ method, url, body: init.body ? JSON.parse(init.body as string) : undefined })
    const key = Object.keys(routes).find(k => {
      const [m, path] = k.split(' ')
      return m === method && url.includes(path)
    })
    const route = key ? routes[key] : { status: 404, body: { error: { message: `no route for ${method} ${url}` } } }
    return { ok: (route.status ?? 200) < 400, status: route.status ?? 200, json: async () => route.body } as Response
  }) as jest.Mock
  return calls
}

function setup(existingLine: { clubId: string } | null = null) {
  const prisma = {
    whatsAppLine: {
      findUnique: jest.fn().mockResolvedValue(existingLine),
      upsert: jest.fn(async ({ create }) => ({ id: 'line-1', ...create })),
    },
  }
  const crypto = { isConfigured: true, encrypt: jest.fn((v: string) => `enc(${v})`), decrypt: jest.fn() }
  const service = new WhatsAppLinesService(prisma as never, crypto as never)
  return { service, prisma }
}

const baseRoutes = (number: Record<string, unknown>): Record<string, Route> => ({
  'GET /oauth/access_token': { body: { access_token: 'biz-token' } },
  [`GET /${WABA}/phone_numbers`]: { body: { data: [{ id: PHONE }] } },
  [`GET /${PHONE}?fields`]: { body: { display_phone_number: '+54 9 341 555-0000', ...number } },
  [`POST /${WABA}/subscribed_apps`]: { body: { success: true } },
  [`POST /${PHONE}/register`]: { body: { success: true } },
  [`POST /${PHONE}/smb_app_data`]: { body: { messaging_product: 'whatsapp', request_id: 'r1' } },
})

const originalFetch = global.fetch
beforeEach(() => {
  process.env.WHATSAPP_APP_ID = 'app'
  process.env.WHATSAPP_APP_SECRET = 'secret'
})
afterAll(() => {
  global.fetch = originalFetch
})

describe('Embedded Signup finish', () => {
  it('coexistence: looks the number up, syncs contacts then history, never registers', async () => {
    const calls = mockGraph(baseRoutes({ is_on_biz_app: true, status: 'CONNECTED' }))
    const { service, prisma } = setup()

    const line = await service.connectEmbeddedSignup(CLUB, { code: 'c', wabaId: WABA, coexistence: true })

    const syncs = calls
      .filter(c => c.url.includes('smb_app_data'))
      .map(c => (c.body as { sync_type: string }).sync_type)
    expect(syncs).toEqual(['smb_app_state_sync', 'history'])
    expect(calls.some(c => c.url.includes('/register'))).toBe(false)
    expect(calls.some(c => c.url.includes(`${WABA}/subscribed_apps`))).toBe(true)
    expect(line).toMatchObject({ phoneNumberId: PHONE, coexistence: true, displayPhone: '+54 9 341 555-0000' })
    expect(prisma.whatsAppLine.upsert.mock.calls[0][0].create.accessToken).toBe('enc(biz-token)')
  })

  it('cloud API: registers a number that is not live yet', async () => {
    const calls = mockGraph(baseRoutes({ status: 'PENDING' }))
    const { service } = setup()
    await service.connectEmbeddedSignup(CLUB, { code: 'c', wabaId: WABA, phoneNumberId: PHONE })
    expect(calls.some(c => c.url.includes(`${PHONE}/register`))).toBe(true)
  })

  it('never re-registers a number that is already live (would reset its PIN)', async () => {
    const calls = mockGraph(baseRoutes({ status: 'CONNECTED' }))
    const { service } = setup()
    await service.connectEmbeddedSignup(CLUB, { code: 'c', wabaId: WABA, phoneNumberId: PHONE })
    expect(calls.some(c => c.url.includes('/register'))).toBe(false)
  })

  it('refuses to guess the number when the WABA has several', async () => {
    const routes = baseRoutes({ is_on_biz_app: true })
    routes[`GET /${WABA}/phone_numbers`] = { body: { data: [{ id: PHONE }, { id: '333' }] } }
    const calls = mockGraph(routes)
    const { service } = setup()
    await expect(
      service.connectEmbeddedSignup(CLUB, { code: 'c', wabaId: WABA, coexistence: true }),
    ).rejects.toBeInstanceOf(BadGatewayException)
    expect(calls.some(c => c.method === 'POST')).toBe(false)
  })

  it('refuses a number that belongs to another club before touching it', async () => {
    const calls = mockGraph(baseRoutes({ status: 'PENDING' }))
    const { service } = setup({ clubId: 'other-club' })
    await expect(
      service.connectEmbeddedSignup(CLUB, { code: 'c', wabaId: WABA, phoneNumberId: PHONE }),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(calls.some(c => c.method === 'POST')).toBe(false)
  })
})
