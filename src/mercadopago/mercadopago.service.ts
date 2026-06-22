import { Injectable, Logger } from '@nestjs/common'
import { createHmac, timingSafeEqual } from 'crypto'

export interface MpPayment {
  status: string
  externalReference: string
  /** Amount received, in cents (transaction_amount * 100). */
  amountCents: number
  /** MP operation type, e.g. "money_transfer" / "cvu_in" for an incoming transfer. */
  operationType: string
}

/** A money-in movement (incoming transfer / CVU fund) as returned by the payments search. */
export interface MpMoneyIn {
  id: string
  amountCents: number
  dateCreated: Date
  operationType: string
}

/** Operation types that represent money arriving into the account (an incoming transfer). */
const MONEY_IN_OPERATION_TYPES = new Set(['account_fund', 'money_transfer', 'cvu_in'])

@Injectable()
export class MercadoPagoService {
  private readonly logger = new Logger(MercadoPagoService.name)
  private readonly baseUrl = 'https://api.mercadopago.com'

  private get accessToken() {
    return process.env.MERCADOPAGO_ACCESS_TOKEN ?? ''
  }

  /** Whether an access token is configured (polling/webhook lookups need it). */
  get isConfigured(): boolean {
    return this.accessToken.length > 0
  }

  /**
   * Lists approved money-in movements (incoming transfers) created since `since`.
   * MercadoPago does NOT fire `payment` webhooks for plain incoming transfers, but
   * it does expose them here — so this is how the deposit flow is reconciled.
   */
  async listRecentMoneyIn(since: Date): Promise<MpMoneyIn[]> {
    const params = new URLSearchParams({
      sort: 'date_created',
      criteria: 'desc',
      status: 'approved',
      range: 'date_created',
      begin_date: since.toISOString(),
      end_date: new Date().toISOString(),
      limit: '50',
    })

    const res = await fetch(`${this.baseUrl}/v1/payments/search?${params.toString()}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    })

    if (!res.ok) {
      const text = await res.text()
      this.logger.error(`MP payments search error ${res.status}: ${text}`)
      throw new Error('Failed to search MercadoPago payments')
    }

    const data = (await res.json()) as {
      results?: Array<{
        id: number | string
        status: string
        transaction_amount: number
        operation_type: string
        date_created: string
      }>
    }

    return (data.results ?? [])
      .filter(p => p.status === 'approved' && MONEY_IN_OPERATION_TYPES.has(p.operation_type))
      .map(p => ({
        id: String(p.id),
        amountCents: Math.round((p.transaction_amount ?? 0) * 100),
        dateCreated: new Date(p.date_created),
        operationType: p.operation_type,
      }))
  }

  async getPayment(paymentId: string): Promise<MpPayment> {
    const res = await fetch(`${this.baseUrl}/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    })

    if (!res.ok) {
      const text = await res.text()
      this.logger.error(`MP payment fetch error ${res.status}: ${text}`)
      throw new Error(`Failed to fetch MP payment ${paymentId}`)
    }

    const data = (await res.json()) as {
      status: string
      external_reference: string | null
      transaction_amount: number
      operation_type: string
    }
    return {
      status: data.status,
      externalReference: data.external_reference ?? '',
      amountCents: Math.round((data.transaction_amount ?? 0) * 100),
      operationType: data.operation_type ?? '',
    }
  }

  /**
   * Verifies the HMAC-SHA256 signature MercadoPago sends in the x-signature header.
   * Format: "ts=<unix_ts>,v1=<hmac_hex>"
   * Signed template: "id:<data.id>;request-id:<x-request-id>;ts:<ts>"
   * Returns true when WEBHOOK_SECRET is not configured (local dev fallback).
   */
  verifyWebhookSignature(dataId: string, xRequestId: string, xSignature: string): boolean {
    const secret = process.env.WEBHOOK_SECRET
    if (!secret) return true

    if (!xSignature) return false

    const parts = xSignature.split(',')
    const ts = parts.find(p => p.startsWith('ts='))?.slice(3)
    const v1 = parts.find(p => p.startsWith('v1='))?.slice(3)
    if (!ts || !v1) return false

    const message = `id:${dataId};request-id:${xRequestId};ts:${ts}`
    const expected = createHmac('sha256', secret).update(message).digest('hex')

    try {
      return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'))
    } catch {
      return false
    }
  }
}
