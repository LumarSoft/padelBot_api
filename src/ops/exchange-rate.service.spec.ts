import { PrismaService } from '../prisma/prisma.service'
import { ExchangeRateService } from './exchange-rate.service'

function setup(stored: { arsCents: number; dateKey: string } | null = null) {
  const prisma = {
    exchangeRate: {
      upsert: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(stored),
    },
  }
  return { prisma, service: new ExchangeRateService(prisma as unknown as PrismaService) }
}

const answer = (body: unknown, ok = true) =>
  jest.fn().mockResolvedValue({ ok, status: ok ? 200 : 503, json: async () => body }) as never

/**
 * The dollar updates itself every day, so nobody has to remember to. A broken answer never
 * replaces a good rate, and without any stored rate the console still has one to use.
 */
describe('ExchangeRateService', () => {
  const configuredRate = process.env.USD_ARS_RATE
  afterEach(() => {
    if (configuredRate === undefined) delete process.env.USD_ARS_RATE
    else process.env.USD_ARS_RATE = configuredRate
  })

  it('stores today’s card dollar in cents', async () => {
    const { prisma, service } = setup()
    global.fetch = answer({ casa: 'tarjeta', venta: 1995.5 })

    await expect(service.refresh('tarjeta')).resolves.toBe(1995.5)

    expect(global.fetch).toHaveBeenCalledWith('https://dolarapi.com/v1/dolares/tarjeta', expect.anything())
    expect(prisma.exchangeRate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ quote: 'tarjeta', arsCents: 199_550 }) }),
    )
  })

  it('keeps the last good rate when the answer is broken or the service is down', async () => {
    const { prisma, service } = setup()
    global.fetch = answer({ venta: 0 })
    await expect(service.refresh('tarjeta')).resolves.toBeNull()
    global.fetch = answer({}, false)
    await expect(service.refresh('tarjeta')).resolves.toBeNull()
    expect(prisma.exchangeRate.upsert).not.toHaveBeenCalled()
  })

  it('prices a month with its last stored quote', async () => {
    const { prisma, service } = setup({ arsCents: 198_000, dateKey: '2026-09-30' })

    await expect(service.rateFor('2026-09', 'tarjeta')).resolves.toEqual({
      rate: 1980,
      quote: 'tarjeta',
      source: 'dolarapi',
      dateKey: '2026-09-30',
    })
    expect(prisma.exchangeRate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { quote: 'tarjeta', dateKey: { lte: '2026-09-31' } } }),
    )
  })

  it('falls back to the configured rate, then to the built-in one', async () => {
    const { service } = setup(null)
    process.env.USD_ARS_RATE = '2100'
    await expect(service.rateFor('2026-10', 'tarjeta')).resolves.toMatchObject({ rate: 2100, source: 'config' })
    delete process.env.USD_ARS_RATE
    await expect(service.rateFor('2026-10', 'tarjeta')).resolves.toMatchObject({ rate: 1995.5, source: 'default' })
  })
})
