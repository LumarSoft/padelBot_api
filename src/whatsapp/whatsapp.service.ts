import { Injectable, Logger } from '@nestjs/common'
import { createHmac, timingSafeEqual } from 'crypto'

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name)
  private get apiVersion() {
    return process.env.WHATSAPP_API_VERSION ?? 'v21.0'
  }
  private get token() {
    return process.env.META_ACCESS_TOKEN ?? ''
  }

  async sendText(phoneNumberId: string, to: string, body: string): Promise<void> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${phoneNumberId}/messages`
    // Argentina mobile wa_ids arrive as 549XXXXXXXXXX but the API requires 54XXXXXXXXXX
    const recipient = to.startsWith('549') && to.length === 13 ? '54' + to.slice(3) : to
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: recipient,
          type: 'text',
          text: { body },
        }),
      })
      if (!response.ok) {
        this.logger.error(`Graph API error ${response.status}: ${await response.text()}`)
      }
    } catch (err) {
      this.logger.error('Failed to reach Graph API', err)
    }
  }

  /**
   * Verifies the HMAC-SHA256 signature Meta attaches to every webhook POST.
   * Returns true if WHATSAPP_APP_SECRET is not configured (local dev / CI).
   */
  verifySignature(rawBody: Buffer, signature: string): boolean {
    const appSecret = process.env.META_APP_SECRET
    if (!appSecret) return true
    if (!signature?.startsWith('sha256=')) return false
    const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex')
    const received = signature.slice(7)
    try {
      return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'))
    } catch {
      return false
    }
  }
}
