import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { createHmac, timingSafeEqual } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { isUniqueConstraintError } from '../prisma/prisma-errors'
import { Interactive } from '../bot/types'

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
    await this.postMessage(phoneNumberId, to, { type: 'text', text: { body } })
  }

  /**
   * Sends a text body together with an interactive botonera (up to 3 quick-reply buttons,
   * or a single-select list). Tapping an option makes WhatsApp deliver its `id` back as the
   * next inbound message, which the bot feeds straight into the FSM. Falls back to plain
   * text when the payload carries no options.
   */
  async sendInteractive(phoneNumberId: string, to: string, body: string, interactive: Interactive): Promise<void> {
    const payload = buildInteractivePayload(body, interactive)
    if (!payload) {
      await this.sendText(phoneNumberId, to, body)
      return
    }
    await this.postMessage(phoneNumberId, to, payload)
  }

  /** Posts a message object to the Graph API, normalizing the recipient and logging failures. */
  private async postMessage(phoneNumberId: string, to: string, message: Record<string, unknown>): Promise<void> {
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
        body: JSON.stringify({ messaging_product: 'whatsapp', to: recipient, ...message }),
      })
      if (response.ok) {
        this.logger.log(`✅ WA enviado a ${recipient}: ${describeOutbound(message)}`)
      }
      if (!response.ok) {
        const text = await response.text()
        // Code 190 / 401 = the Meta access token expired or was revoked. The bot still
        // ran (reply saved in the platform) but WhatsApp delivery failed — surface a
        // clear, actionable line instead of a raw Graph dump.
        if (response.status === 401 || text.includes('"code":190')) {
          this.logger.error(
            'WhatsApp token expired/invalid (Graph 401/190). The bot processed the message but ' +
              'could NOT deliver it on WhatsApp. Generate a permanent System User token in Meta and ' +
              'set WHATSAPP_TOKEN. Temporary tokens expire every ~24h.',
          )
        } else {
          this.logger.error(`Graph API error ${response.status}: ${text}`)
        }
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

/** A one-line, length-capped summary of an outbound message object, for clean send logs. */
function describeOutbound(message: Record<string, unknown>): string {
  const text =
    (message.text as { body?: string } | undefined)?.body ??
    (message.interactive as { body?: { text?: string } } | undefined)?.body?.text ??
    `[${String(message.type ?? 'mensaje')}]`
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length <= 140 ? oneLine : oneLine.slice(0, 139) + '…'
}

/**
 * Translates our transport-agnostic Interactive into a Graph API `interactive` message
 * object — a `button` message (≤3 quick replies) or a `list` message. Returns null when
 * there are no options, so the caller sends plain text instead.
 */
function buildInteractivePayload(body: string, interactive: Interactive): Record<string, unknown> | null {
  if (interactive.buttons?.length) {
    return {
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body },
        action: {
          buttons: interactive.buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
        },
      },
    }
  }

  if (interactive.list?.rows.length) {
    return {
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: body },
        action: {
          button: interactive.list.button,
          sections: [
            {
              rows: interactive.list.rows.map(r => ({
                id: r.id,
                title: r.title,
                ...(r.description ? { description: r.description } : {}),
              })),
            },
          ],
        },
      },
    }
  }

  return null
}
