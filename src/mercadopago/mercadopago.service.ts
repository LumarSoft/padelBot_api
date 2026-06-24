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
  /** Account holder name, when MP exposes it (usually null for CVU/alias transfers). */
  payerName: string | null
  /** Payer's CUIT/CUIL/DNI number, when MP exposes it. Used to validate the titular. */
  payerCuit: string | null
  /** Payer's email, when MP exposes it. */
  payerEmail: string | null
  /** Payer's MercadoPago user id, when MP exposes it. */
  payerMpUserId: string | null
}

/** Raw payer block MercadoPago may attach to a payment. Only some fields appear for transfers. */
interface MpPayerRaw {
  id?: string | number
  email?: string | null
  first_name?: string | null
  last_name?: string | null
  identification?: { type?: string | null; number?: string | null } | null
  entity_type?: string | null
}

/** Builds a display name from an MP payer block, or null when there's nothing usable. */
function buildPayerName(payer?: MpPayerRaw | null): string | null {
  if (!payer) return null
  const full = `${payer.first_name ?? ''} ${payer.last_name ?? ''}`.trim()
  return full.length > 0 ? full : null
}

/** Operation types that represent money arriving into the account (an incoming transfer). */
const MONEY_IN_OPERATION_TYPES = new Set(['account_fund', 'money_transfer', 'cvu_in'])

/** Tokens + metadata returned by the MercadoPago OAuth token endpoint. */
export interface MpOAuthTokens {
  accessToken: string
  refreshToken: string
  /** MP user id of the account that authorized the connection. */
  userId: string
  /** Absolute expiry of the access token. */
  expiresAt: Date
}

@Injectable()
export class MercadoPagoService {
  private readonly logger = new Logger(MercadoPagoService.name)
  private readonly baseUrl = 'https://api.mercadopago.com'

  /** The shared/legacy access token (single-account fallback for clubs not yet connected). */
  private get envAccessToken() {
    return process.env.MERCADOPAGO_ACCESS_TOKEN ?? ''
  }

  /** Resolves the token to use for an API call: a per-club token, else the env fallback. */
  private resolveToken(token?: string): string {
    return token && token.length > 0 ? token : this.envAccessToken
  }

  /** Whether a shared/legacy access token is configured (fallback reconciliation path). */
  get isConfigured(): boolean {
    return this.envAccessToken.length > 0
  }

  /** Whether MercadoPago Connect (OAuth) is configured so clubs can link their own account. */
  get isOAuthConfigured(): boolean {
    return !!(process.env.MP_OAUTH_CLIENT_ID && process.env.MP_OAUTH_CLIENT_SECRET && process.env.MP_OAUTH_REDIRECT_URI)
  }

  // ── OAuth (MercadoPago Connect) ─────────────────────────────────────────────

  /**
   * Authorization URL the club owner is redirected to so they grant access to their
   * own MercadoPago account. `state` is an opaque, signed value we verify on callback.
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: process.env.MP_OAUTH_CLIENT_ID!,
      response_type: 'code',
      platform_id: 'mp',
      redirect_uri: process.env.MP_OAUTH_REDIRECT_URI!,
      state,
    })
    return `https://auth.mercadopago.com.ar/authorization?${params.toString()}`
  }

  /** Exchanges the OAuth `code` from the callback for the club's access/refresh tokens. */
  async exchangeCodeForToken(code: string): Promise<MpOAuthTokens> {
    return this.requestToken({
      grant_type: 'authorization_code',
      client_id: process.env.MP_OAUTH_CLIENT_ID!,
      client_secret: process.env.MP_OAUTH_CLIENT_SECRET!,
      code,
      redirect_uri: process.env.MP_OAUTH_REDIRECT_URI!,
    })
  }

  /** Refreshes a club's access token before it expires using its refresh token. */
  async refreshAccessToken(refreshToken: string): Promise<MpOAuthTokens> {
    return this.requestToken({
      grant_type: 'refresh_token',
      client_id: process.env.MP_OAUTH_CLIENT_ID!,
      client_secret: process.env.MP_OAUTH_CLIENT_SECRET!,
      refresh_token: refreshToken,
    })
  }

  private async requestToken(payload: Record<string, string>): Promise<MpOAuthTokens> {
    const res = await fetch(`${this.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const text = await res.text()
      this.logger.error(`MP OAuth token error ${res.status}: ${text}`)
      throw new Error('Failed to obtain MercadoPago token')
    }

    const data = (await res.json()) as {
      access_token: string
      refresh_token: string
      user_id: number | string
      expires_in: number
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      userId: String(data.user_id),
      expiresAt: new Date(Date.now() + (data.expires_in ?? 0) * 1000),
    }
  }

  // ── Payments API ────────────────────────────────────────────────────────────

  /**
   * Lists approved money-in movements (incoming transfers) created since `since`.
   * MercadoPago does NOT fire `payment` webhooks for plain incoming transfers, but
   * it does expose them here — so this is how the deposit flow is reconciled.
   * `token` selects the account to read (a club's own token; falls back to env).
   */
  async listRecentMoneyIn(since: Date, token?: string): Promise<MpMoneyIn[]> {
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
      headers: { Authorization: `Bearer ${this.resolveToken(token)}` },
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
        description?: string | null
        payer?: MpPayerRaw | null
      }>
    }

    const moneyIn = (data.results ?? []).filter(
      p => p.status === 'approved' && MONEY_IN_OPERATION_TYPES.has(p.operation_type),
    )

    // Investigation (MP_DEBUG_PAYER=true): log exactly what payer data MP returns for
    // incoming transfers on THIS account, to decide whether name-based reconciliation is
    // feasible. Does not affect matching — reconciliation is still by amount.
    if (process.env.MP_DEBUG_PAYER === 'true') {
      for (const p of moneyIn) {
        this.logger.log(
          `[MP_DEBUG_PAYER] id=${p.id} op=${p.operation_type} amount=${p.transaction_amount} ` +
            `payer=${JSON.stringify(p.payer ?? null)} description=${JSON.stringify(p.description ?? null)}`,
        )
      }
    }

    return moneyIn.map(p => ({
      id: String(p.id),
      amountCents: Math.round((p.transaction_amount ?? 0) * 100),
      dateCreated: new Date(p.date_created),
      operationType: p.operation_type,
      payerName: buildPayerName(p.payer),
      payerCuit: p.payer?.identification?.number ?? null,
      payerEmail: p.payer?.email ?? null,
      payerMpUserId: p.payer?.id != null ? String(p.payer.id) : null,
    }))
  }

  async getPayment(paymentId: string, token?: string): Promise<MpPayment> {
    const res = await fetch(`${this.baseUrl}/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${this.resolveToken(token)}` },
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
