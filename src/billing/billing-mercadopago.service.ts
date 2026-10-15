import { Injectable, Logger } from '@nestjs/common'
import { createHmac, timingSafeEqual } from 'crypto'

/** What a credit-pack checkout needs from MercadoPago. */
export interface PackPreferenceInput {
  title: string
  priceCents: number
  externalReference: string
  /** Where MercadoPago sends the owner back (MP appends payment_id, collection_status…). */
  returnUrl: string
}

export interface BillingPayment {
  id: string
  /** approved | pending | in_process | rejected | cancelled | refunded | charged_back… */
  status: string
  externalReference: string | null
  amountCents: number
}

/**
 * MercadoPago for what CLUBS pay LUMARSOFT (credit packs) — a different account from the clubs'
 * own MercadoPago (MercadoPagoService), where players pay their señas. Config:
 *   BILLING_MP_ACCESS_TOKEN    Lumarsoft's access token (of the account that collects).
 *   BILLING_MP_WEBHOOK_SECRET  the signing secret of that app's webhooks (x-signature).
 *   API_PUBLIC_URL             public base URL of this API, for the payment notifications.
 *   ADMIN_ORIGIN               the panel, where the owner comes back after paying.
 */
@Injectable()
export class BillingMercadoPagoService {
  private readonly logger = new Logger(BillingMercadoPagoService.name)
  private readonly baseUrl = 'https://api.mercadopago.com'

  private get token(): string {
    return process.env.BILLING_MP_ACCESS_TOKEN ?? ''
  }

  /** Whether packs can be bought at all (Lumarsoft's MercadoPago is configured). */
  get isConfigured(): boolean {
    return this.token.length > 0
  }

  /** Creates the Checkout Pro preference; returns its id and the URL to send the owner to. */
  async createPackPreference(input: PackPreferenceInput): Promise<{ id: string; checkoutUrl: string }> {
    const apiUrl = process.env.API_PUBLIC_URL?.replace(/\/$/, '')
    const body = {
      items: [
        {
          id: input.externalReference,
          title: input.title,
          quantity: 1,
          currency_id: 'ARS',
          unit_price: input.priceCents / 100,
        },
      ],
      external_reference: input.externalReference,
      back_urls: { success: input.returnUrl, pending: input.returnUrl, failure: input.returnUrl },
      // MercadoPago only auto-returns to an https URL; on a local panel the owner taps "Volver".
      ...(input.returnUrl.startsWith('https://') ? { auto_return: 'approved' } : {}),
      // Without a public API (local dev) the owner's return to the panel confirms the payment.
      ...(apiUrl ? { notification_url: `${apiUrl}/billing/mercadopago/webhook` } : {}),
      statement_descriptor: 'GTP CREDITOS',
    }
    const res = await fetch(`${this.baseUrl}/checkout/preferences`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      this.logger.error(`MP preference error ${res.status}: ${await res.text()}`)
      throw new Error('Could not create the MercadoPago preference')
    }
    const data = (await res.json()) as { id: string; init_point: string }
    return { id: data.id, checkoutUrl: data.init_point }
  }

  async getPayment(paymentId: string): Promise<BillingPayment> {
    const res = await fetch(`${this.baseUrl}/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    })
    if (!res.ok) {
      this.logger.error(`MP payment fetch error ${res.status}: ${await res.text()}`)
      throw new Error(`Could not fetch MercadoPago payment ${paymentId}`)
    }
    const data = (await res.json()) as {
      id: number | string
      status: string
      external_reference: string | null
      transaction_amount: number
    }
    return {
      id: String(data.id),
      status: data.status,
      externalReference: data.external_reference ?? null,
      amountCents: Math.round((data.transaction_amount ?? 0) * 100),
    }
  }

  /**
   * Verifies the `x-signature` MercadoPago puts on webhooks: HMAC-SHA256 with the app's secret over
   * the manifest `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` (data.id lowercased; a part
   * whose value is missing is left out). Without a secret it only passes outside production, so
   * a misconfigured prod never accepts unsigned notifications.
   */
  verifySignature(dataId: string, xRequestId: string | undefined, xSignature: string | undefined): boolean {
    const secret = process.env.BILLING_MP_WEBHOOK_SECRET
    if (!secret) return process.env.NODE_ENV !== 'production'
    if (!xSignature) return false

    const parts = Object.fromEntries(
      xSignature.split(',').map(part => {
        const [key, ...value] = part.trim().split('=')
        return [key, value.join('=')]
      }),
    ) as Record<string, string | undefined>
    const { ts, v1 } = parts
    if (!ts || !v1) return false

    let manifest = ''
    if (dataId) manifest += `id:${dataId.toLowerCase()};`
    if (xRequestId) manifest += `request-id:${xRequestId};`
    manifest += `ts:${ts};`
    const expected = createHmac('sha256', secret).update(manifest).digest('hex')
    try {
      return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'))
    } catch {
      return false
    }
  }
}
