/**
 * Thin Graph API calls used to onboard a club's number through Meta's Embedded Signup.
 * Every call throws MetaGraphError with Meta's own message so the service can log it and
 * map it to a clean client error.
 */

const GRAPH = 'https://graph.facebook.com'

export class MetaGraphError extends Error {
  constructor(
    readonly step: string,
    readonly detail: string,
  ) {
    super(`${step}: ${detail}`)
  }
}

function apiVersion(): string {
  return process.env.WHATSAPP_API_VERSION ?? 'v21.0'
}

async function call<T>(step: string, url: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (err) {
    throw new MetaGraphError(step, `network error (${(err as Error).message})`)
  }
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } } & T
  if (!response.ok || body?.error) {
    throw new MetaGraphError(step, body?.error?.message ?? `HTTP ${response.status}`)
  }
  return body
}

/**
 * Exchanges the Embedded Signup `code` (30s TTL) for the business-integration token of the
 * customer's WABA. With the JS SDK flow no redirect_uri is involved.
 */
export async function exchangeCode(code: string, appId: string, appSecret: string): Promise<string> {
  const params = new URLSearchParams({ client_id: appId, client_secret: appSecret, code })
  const body = await call<{ access_token?: string }>(
    'exchange_code',
    `${GRAPH}/${apiVersion()}/oauth/access_token?${params.toString()}`,
  )
  if (!body.access_token) throw new MetaGraphError('exchange_code', 'Meta returned no access_token')
  return body.access_token
}

function authed(token: string, method: 'GET' | 'POST', json?: unknown): RequestInit {
  return {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
    ...(json ? { body: JSON.stringify(json) } : {}),
  }
}

/** Subscribes our app to the WABA's webhooks — without it no message ever reaches /webhook. */
export async function subscribeApp(wabaId: string, token: string): Promise<void> {
  await call('subscribe_app', `${GRAPH}/${apiVersion()}/${wabaId}/subscribed_apps`, authed(token, 'POST'))
}

/**
 * Registers a Cloud-API-only number (NOT for coexistence: a number that stays on the
 * WhatsApp Business app is already registered and must skip this step).
 */
export async function registerNumber(phoneNumberId: string, token: string, pin: string): Promise<void> {
  await call(
    'register_number',
    `${GRAPH}/${apiVersion()}/${phoneNumberId}/register`,
    authed(token, 'POST', { messaging_product: 'whatsapp', pin }),
  )
}

/**
 * Coexistence only: asks Meta to sync the app's contacts and then the chat history. Must run
 * within 24h of onboarding and each type can run only once per onboarding.
 */
export async function syncBusinessAppData(
  phoneNumberId: string,
  token: string,
  syncType: 'smb_app_state_sync' | 'history',
): Promise<void> {
  await call(
    `sync_${syncType}`,
    `${GRAPH}/${apiVersion()}/${phoneNumberId}/smb_app_data`,
    authed(token, 'POST', { messaging_product: 'whatsapp', sync_type: syncType }),
  )
}

/** The WABA's phone number ids (a WABA fresh out of Embedded Signup has exactly one). */
export async function listWabaNumbers(wabaId: string, token: string): Promise<string[]> {
  const body = await call<{ data?: { id: string }[] }>(
    'list_numbers',
    `${GRAPH}/${apiVersion()}/${wabaId}/phone_numbers?fields=id`,
    authed(token, 'GET'),
  )
  return (body.data ?? []).map(n => n.id)
}

export interface PhoneNumberInfo {
  display_phone_number?: string
  verified_name?: string
  is_on_biz_app?: boolean
  platform_type?: string
  /** "CONNECTED" once the number is registered and live on the Cloud API. */
  status?: string
}

export async function fetchPhoneNumber(phoneNumberId: string, token: string): Promise<PhoneNumberInfo> {
  const fields = 'display_phone_number,verified_name,is_on_biz_app,platform_type,status'
  return call<PhoneNumberInfo>(
    'fetch_number',
    `${GRAPH}/${apiVersion()}/${phoneNumberId}?fields=${fields}`,
    authed(token, 'GET'),
  )
}
