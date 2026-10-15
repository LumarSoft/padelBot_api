import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common'
import { createHmac } from 'crypto'
import { notifyOps } from '../common/ops-alert'
import { BillingMercadoPagoService, BillingPayment } from './billing-mercadopago.service'
import { BillingService } from './billing.service'

jest.mock('../common/ops-alert', () => ({ notifyOps: jest.fn().mockResolvedValue(undefined) }))

const ACTIVE = {
  subscriptionStatus: 'ACTIVE',
  plan: 'saque',
  trialEndsAt: null,
  currentPeriodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
}
const LAPSED = { ...ACTIVE, subscriptionStatus: 'CANCELLED' }

interface PurchaseRow {
  id: string
  status: string
  credits: number
  priceCents: number
  mpPaymentId: string | null
  club: { name: string }
}

function setup(opts: { club?: object; purchase?: Partial<PurchaseRow>; mpConfigured?: boolean } = {}) {
  const purchase: PurchaseRow = {
    id: 'cp1',
    status: 'PENDING',
    credits: 1_000,
    priceCents: 8_999_900,
    mpPaymentId: null,
    club: { name: 'Padel Norte' },
    ...opts.purchase,
  }
  const prisma = {
    club: { findUnique: jest.fn().mockResolvedValue(opts.club ?? ACTIVE) },
    creditPackPurchase: {
      create: jest.fn().mockResolvedValue({ id: 'cp1' }),
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(purchase),
      findFirst: jest.fn().mockResolvedValue({ id: 'cp1' }),
      findUniqueOrThrow: jest.fn(async () => purchase),
      updateMany: jest.fn(async ({ where, data }: { where: { status: unknown }; data: Partial<PurchaseRow> }) => {
        const matches =
          typeof where.status === 'string' ? purchase.status === where.status : purchase.status !== 'APPROVED'
        if (!matches) return { count: 0 }
        Object.assign(purchase, data)
        return { count: 1 }
      }),
    },
  }
  const mp = {
    isConfigured: opts.mpConfigured ?? true,
    createPackPreference: jest.fn().mockResolvedValue({ id: 'pref-1', checkoutUrl: 'https://mp.test/checkout' }),
    getPayment: jest.fn(),
    verifySignature: jest.fn().mockReturnValue(true),
  }
  const service = new BillingService(prisma as never, {} as never, mp as unknown as BillingMercadoPagoService)
  return { prisma, mp, purchase, service }
}

const payment = (over: Partial<BillingPayment> = {}): BillingPayment => ({
  id: '123456',
  status: 'approved',
  externalReference: 'gtp-credits:cp1',
  amountCents: 8_999_900,
  ...over,
})

describe('BillingService.buyPack', () => {
  it('opens a MercadoPago checkout for the pack at the catalog price', async () => {
    const { prisma, mp, service } = setup()

    const result = await service.buyPack('c1', 7, 'pack-1000')

    expect(result).toEqual({ purchaseId: 'cp1', checkoutUrl: 'https://mp.test/checkout' })
    expect(prisma.creditPackPurchase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { clubId: 'c1', packKey: 'pack-1000', credits: 1_000, priceCents: 8_999_900, createdByUserId: 7 },
      }),
    )
    expect(mp.createPackPreference).toHaveBeenCalledWith(
      expect.objectContaining({
        priceCents: 8_999_900,
        externalReference: 'gtp-credits:cp1',
        returnUrl: expect.stringContaining('/panel/facturacion?compra=cp1'),
      }),
    )
  })

  it('needs an active plan', async () => {
    const { service } = setup({ club: LAPSED })
    await expect(service.buyPack('c1', 7, 'pack-500')).rejects.toThrow(ForbiddenException)
  })

  it('says so when Lumarsoft MercadoPago is not configured yet', async () => {
    const { prisma, service } = setup({ mpConfigured: false })
    await expect(service.buyPack('c1', 7, 'pack-500')).rejects.toThrow(ServiceUnavailableException)
    expect(prisma.creditPackPurchase.create).not.toHaveBeenCalled()
  })
})

/**
 * A pack is credited once, only for an approved payment that covers it — whether the webhook or
 * the owner's return gets there first, and however many times MercadoPago retries.
 */
describe('BillingService.applyPayment', () => {
  beforeEach(() => jest.mocked(notifyOps).mockClear())

  it('credits an approved payment for six months and tells ops once', async () => {
    const { purchase, service } = setup()

    await service.applyPayment(payment())
    await service.applyPayment(payment())

    expect(purchase.status).toBe('APPROVED')
    expect(purchase.mpPaymentId).toBe('123456')
    const expiresAt = (purchase as unknown as { expiresAt: Date }).expiresAt
    const months =
      (expiresAt.getFullYear() - new Date().getFullYear()) * 12 + expiresAt.getMonth() - new Date().getMonth()
    expect(months).toBe(6)
    expect(notifyOps).toHaveBeenCalledTimes(1)
    expect(jest.mocked(notifyOps).mock.calls[0][0]).toContain('Padel Norte* compró 1.000 créditos')
  })

  it('does not credit a payment that falls short of the pack price', async () => {
    const { purchase, service } = setup()

    await service.applyPayment(payment({ amountCents: 100 }))

    expect(purchase.status).toBe('PENDING')
  })

  it('marks a rejected payment, and never un-approves a pack', async () => {
    const pending = setup()
    await pending.service.applyPayment(payment({ status: 'rejected' }))
    expect(pending.purchase.status).toBe('REJECTED')

    const approved = setup({ purchase: { status: 'APPROVED', mpPaymentId: '123456' } })
    await approved.service.applyPayment(payment({ status: 'refunded' }))
    expect(approved.purchase.status).toBe('APPROVED')
  })

  it('ignores payments that are not credit packs', async () => {
    const { prisma, service } = setup()

    await service.applyPayment(payment({ externalReference: 'booking-123' }))

    expect(prisma.creditPackPurchase.findUnique).not.toHaveBeenCalled()
  })
})

describe('BillingService webhook and return', () => {
  it('refuses a notification with a bad signature', async () => {
    const { mp, service } = setup()
    mp.verifySignature.mockReturnValue(false)

    await expect(service.handleWebhook('123456', 'payment', 'req-1', 'ts=1,v1=00')).rejects.toThrow(ForbiddenException)
    expect(mp.getPayment).not.toHaveBeenCalled()
  })

  it('ignores notifications that are not payments', async () => {
    const { mp, service } = setup()

    await service.handleWebhook('987', 'merchant_order', 'req-1', 'ts=1,v1=00')

    expect(mp.getPayment).not.toHaveBeenCalled()
  })

  it('credits the pack when the owner comes back with its approved payment', async () => {
    const { mp, purchase, service } = setup()
    mp.getPayment.mockResolvedValue(payment())

    await service.confirmReturn('c1', 'cp1', '123456')

    expect(purchase.status).toBe('APPROVED')
  })

  it('refuses a payment id that belongs to another purchase', async () => {
    const { mp, service } = setup()
    mp.getPayment.mockResolvedValue(payment({ externalReference: 'gtp-credits:other' }))

    await expect(service.confirmReturn('c1', 'cp1', '123456')).rejects.toThrow(BadRequestException)
  })
})

describe('BillingMercadoPagoService.verifySignature', () => {
  const secret = 'test-secret'
  const sign = (manifest: string) => createHmac('sha256', secret).update(manifest).digest('hex')

  beforeEach(() => {
    process.env.BILLING_MP_WEBHOOK_SECRET = secret
  })
  afterEach(() => {
    delete process.env.BILLING_MP_WEBHOOK_SECRET
  })

  it('accepts the signature MercadoPago computes over id, request-id and ts', () => {
    const v1 = sign('id:123456;request-id:req-1;ts:1700000000;')
    expect(new BillingMercadoPagoService().verifySignature('123456', 'req-1', `ts=1700000000,v1=${v1}`)).toBe(true)
  })

  it('rejects a signature for another payment', () => {
    const v1 = sign('id:999;request-id:req-1;ts:1700000000;')
    expect(new BillingMercadoPagoService().verifySignature('123456', 'req-1', `ts=1700000000,v1=${v1}`)).toBe(false)
  })
})
