import { createHmac } from 'crypto'
import { MercadoPagoService, webhookManifest } from './mercadopago.service'

const KEY = 'unit-test-key'
const sign = (manifest: string, key = KEY) => createHmac('sha256', key).update(manifest).digest('hex')

/**
 * MercadoPago signs "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" — trailing ";" included,
 * data.id lowercased, missing parts left out. A signature built that way must pass.
 */
describe('MercadoPago webhook signature', () => {
  const env = { ...process.env }
  beforeEach(() => {
    process.env.WEBHOOK_SECRET = KEY
  })
  afterEach(() => {
    process.env = { ...env }
  })

  const service = new MercadoPagoService()

  it('builds the manifest the way MercadoPago documents it', () => {
    expect(webhookManifest('123456', 'req-1', '1742505638683')).toBe('id:123456;request-id:req-1;ts:1742505638683;')
    expect(webhookManifest('ORD01JQ', '', '17')).toBe('id:ord01jq;ts:17;')
  })

  it('accepts a signature made by MercadoPago', () => {
    const v1 = sign('id:123456;request-id:req-1;ts:1742505638683;')
    expect(service.verifyWebhookSignature('123456', 'req-1', `ts=1742505638683,v1=${v1}`)).toBe(true)
  })

  it('refuses the old manifest without the trailing ";", and another key', () => {
    const old = sign('id:123456;request-id:req-1;ts:1742505638683')
    expect(service.verifyWebhookSignature('123456', 'req-1', `ts=1742505638683,v1=${old}`)).toBe(false)
    const other = sign('id:123456;request-id:req-1;ts:1;', 'another-key')
    expect(service.verifyWebhookSignature('123456', 'req-1', `ts=1,v1=${other}`)).toBe(false)
  })

  it('refuses a missing or malformed header', () => {
    expect(service.verifyWebhookSignature('123456', 'req-1', '')).toBe(false)
    expect(service.verifyWebhookSignature('123456', 'req-1', 'v1=abc')).toBe(false)
  })
})
