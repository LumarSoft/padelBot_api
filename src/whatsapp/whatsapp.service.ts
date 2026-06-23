import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { createHmac, timingSafeEqual } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { isUniqueConstraintError } from '../prisma/prisma-errors'

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name)

  constructor(private readonly prisma: PrismaService) {}

  private get apiVersion() {
    return process.env.WHATSAPP_API_VERSION ?? 'v21.0'
  }
  private get token() {
    // Canonical name is WHATSAPP_TOKEN; META_ACCESS_TOKEN kept as a fallback.
    return process.env.WHATSAPP_TOKEN ?? process.env.META_ACCESS_TOKEN ?? ''
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
   * Records a Meta message id and reports whether it's new. Returns true the first time
   * (caller should process), false if it was already handled (a retry → skip). The insert
   * is atomic, so concurrent retries / multiple instances can't both process the message.
   */
  async claimMessage(messageId: string): Promise<boolean> {
    try {
      await this.prisma.processedWebhookMessage.create({ data: { id: messageId } })
      return true
    } catch (err) {
      if (isUniqueConstraintError(err)) return false
      // On an unexpected DB error, fail open (process the message) so we don't drop it.
      this.logger.error('Failed to claim webhook message id', err)
      return true
    }
  }

  /** Prunes processed-message dedup rows older than a day (Meta retries within minutes). */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async pruneProcessedMessages(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    try {
      await this.prisma.processedWebhookMessage.deleteMany({ where: { createdAt: { lt: cutoff } } })
    } catch (err) {
      this.logger.error('Failed to prune processed webhook messages', err)
    }
  }

  /**
   * Verifies the HMAC-SHA256 signature Meta attaches to every webhook POST.
   * Returns true if WHATSAPP_APP_SECRET is not configured (local dev / CI).
   */
  verifySignature(rawBody: Buffer, signature: string): boolean {
    const appSecret = process.env.WHATSAPP_APP_SECRET ?? process.env.META_APP_SECRET
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
