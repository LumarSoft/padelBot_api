import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { schedulerEnabled } from '../common/scheduling'
import { createHmac, timingSafeEqual } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { isUniqueConstraintError } from '../prisma/prisma-errors'
import { Interactive } from '../bot/types'
import { WhatsAppLinesService } from '../whatsapp-lines/whatsapp-lines.service'
import { CreditsService, OutboundKind } from '../plans/credits.service'
import { notifyOps } from '../common/ops-alert'

/** Who wrote a free-form message: the bot (a credit of the club) or the staff from the panel. */
export type OutboundSender = 'bot' | 'staff'

/**
 * Graph error codes for "Meta won't send because of payment" (the WABA's payment method failed
 * or ran out). The bot goes mute on that number until it's fixed, so ops must hear right away.
 */
const META_PAYMENT_ERROR_CODES = new Set([131042])
/** One ops alert per number per hour: every reply fails the same way until it's fixed. */
const PAYMENT_ALERT_EVERY_MS = 60 * 60 * 1000

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name)
  /** phoneNumberId → last payment-rejection alert. */
  private readonly paymentAlerts = new Map<string, number>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly lines: WhatsAppLinesService,
    private readonly credits: CreditsService,
  ) {}

  private get apiVersion() {
    return process.env.WHATSAPP_API_VERSION ?? 'v21.0'
  }
  private get token() {
    // Canonical name is WHATSAPP_TOKEN; META_ACCESS_TOKEN kept as a fallback.
    return process.env.WHATSAPP_TOKEN ?? process.env.META_ACCESS_TOKEN ?? ''
  }

  /** `sender: 'staff'` for a reply typed in the panel: it's our cost, never the club's credits. */
  async sendText(phoneNumberId: string, to: string, body: string, sender: OutboundSender = 'bot'): Promise<boolean> {
    return this.postMessage(phoneNumberId, to, { type: 'text', text: { body } }, sender)
  }

  /**
   * Sends a critical text (payment confirmed/expired, etc.) retrying with backoff when
   * Graph delivery fails. A confirmation the player never receives means "the money
   * arrived and nobody told me" — worth a few retries before giving up. Returns whether
   * the message was ultimately delivered so the caller can log/alert on total failure.
   */
  async sendTextWithRetry(phoneNumberId: string, to: string, body: string, attempts = 3): Promise<boolean> {
    const delaysMs = [1_000, 5_000, 15_000]
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await this.sendText(phoneNumberId, to, body)) return true
      if (attempt < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, delaysMs[Math.min(attempt, delaysMs.length - 1)]))
      }
    }
    this.logger.error(`WA message to ${to} NOT delivered after ${attempts} attempts`)
    return false
  }

  /**
   * Sends a text body together with an interactive botonera (up to 3 quick-reply buttons,
   * or a single-select list). Tapping an option makes WhatsApp deliver its `id` back as the
   * next inbound message, which the bot feeds straight into the FSM. Falls back to plain
   * text when the payload carries no options.
   */
  async sendInteractive(phoneNumberId: string, to: string, body: string, interactive: Interactive): Promise<boolean> {
    const payload = buildInteractivePayload(body, interactive)
    if (!payload) {
      return this.sendText(phoneNumberId, to, body)
    }
    return this.postMessage(phoneNumberId, to, payload)
  }

  /**
   * Sends a pre-approved Meta message template (HSM). Required for any business-initiated
   * message outside the 24h customer-service window (e.g. a booking reminder) — Meta rejects
   * free-form `sendText` in that case. `bodyParams` fill the template's `{{1}}`, `{{2}}`… in
   * order; the template itself (name, language, wording) must already be approved in the
   * WhatsApp Business Manager for the number behind `phoneNumberId`.
   *
   * `quickReplyPayloads` fill the template's quick-reply buttons, in order (index 0, 1…). A tap
   * comes back as an inbound `button` message carrying that payload, which is how the reply is
   * tied to what was asked (e.g. which booking a "No puedo" is about).
   */
  async sendTemplate(
    phoneNumberId: string,
    to: string,
    templateName: string,
    languageCode: string,
    bodyParams: string[],
    quickReplyPayloads: string[] = [],
  ): Promise<boolean> {
    return this.postMessage(phoneNumberId, to, {
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [
          {
            type: 'body',
            parameters: bodyParams.map(text => ({ type: 'text', text })),
          },
          ...quickReplyPayloads.map((payload, index) => ({
            type: 'button',
            sub_type: 'quick_reply',
            index: String(index),
            parameters: [{ type: 'payload', payload }],
          })),
        ],
      },
    })
  }

  /**
   * Posts a message object to the Graph API, normalizing the recipient and logging
   * failures. Returns whether Graph accepted the message (used by the retry path).
   */
  private async postMessage(
    phoneNumberId: string,
    to: string,
    message: Record<string, unknown>,
    sender: OutboundSender = 'bot',
  ): Promise<boolean> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${phoneNumberId}/messages`
    // Argentina mobile wa_ids arrive as 549XXXXXXXXXX but the API requires 54XXXXXXXXXX
    const recipient = to.startsWith('549') && to.length === 13 ? '54' + to.slice(3) : to
    // A number connected via Embedded Signup sends with its own WABA token; manual lines
    // (and our own numbers) use the global one.
    const token = (await this.lines.findAccessToken(phoneNumberId)) ?? this.token
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: recipient, ...message }),
      })
      if (response.ok) {
        this.logger.log(`✅ WA enviado a ${recipient}: ${describeOutbound(message)}`)
        // Only what Graph accepted counts: a credit for the club, a message on our Meta bill.
        void this.credits.recordSent(phoneNumberId, outboundKind(message, sender))
        return true
      }
      const text = await response.text()
      if (META_PAYMENT_ERROR_CODES.has(graphErrorCode(text))) void this.alertPaymentRejection(phoneNumberId, text)
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
      return false
    } catch (err) {
      this.logger.error('Failed to reach Graph API', err)
      return false
    }
  }

  /**
   * Meta refused to send because of payment: the bot is mute on this number until the payment
   * method is fixed in Meta. Ops hears it at once (then hourly while it lasts); never throws.
   */
  private async alertPaymentRejection(phoneNumberId: string, graphError: string): Promise<void> {
    const last = this.paymentAlerts.get(phoneNumberId) ?? 0
    if (Date.now() - last < PAYMENT_ALERT_EVERY_MS) return
    this.paymentAlerts.set(phoneNumberId, Date.now())
    try {
      const line = await this.prisma.whatsAppLine.findUnique({
        where: { phoneNumberId },
        select: { displayPhone: true, club: { select: { name: true } } },
      })
      const who = line ? `*${line.club.name}* (${line.displayPhone})` : `el número ${phoneNumberId}`
      await notifyOps(
        `🚨 Meta rechazó un mensaje de ${who} por un problema de pago (código 131042). ` +
          `El bot no puede responder por ese número hasta regularizar el pago en Meta.\n${graphError.slice(0, 300)}`,
      )
    } catch (err) {
      this.logger.error('Could not alert ops about a Meta payment rejection', err)
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
    if (!schedulerEnabled()) return
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    try {
      await this.prisma.processedWebhookMessage.deleteMany({ where: { createdAt: { lt: cutoff } } })
    } catch (err) {
      this.logger.error('Failed to prune processed webhook messages', err)
    }
  }

  /**
   * Verifies the HMAC-SHA256 signature Meta attaches to every webhook POST.
   * Skips verification if WHATSAPP_APP_SECRET is not configured — but only outside
   * production, so a missing/misconfigured secret disables the local-dev/CI convenience
   * instead of silently accepting unsigned webhook payloads in prod.
   */
  verifySignature(rawBody: Buffer, signature: string): boolean {
    const appSecret = process.env.WHATSAPP_APP_SECRET ?? process.env.META_APP_SECRET
    if (!appSecret) return process.env.NODE_ENV !== 'production'
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

/** Templates are Meta's utility category; everything else is a service message. */
function outboundKind(message: Record<string, unknown>, sender: OutboundSender): OutboundKind {
  if (message.type === 'template') return 'utility'
  return sender === 'staff' ? 'staffService' : 'botService'
}

/** The Graph `error.code` of a failed send (0 when the body isn't the usual JSON error). */
export function graphErrorCode(body: string): number {
  try {
    return Number((JSON.parse(body) as { error?: { code?: number } }).error?.code) || 0
  } catch {
    return 0
  }
}

/** A one-line, length-capped summary of an outbound message object, for clean send logs. */
function describeOutbound(message: Record<string, unknown>): string {
  const text =
    (message.text as { body?: string } | undefined)?.body ??
    (message.interactive as { body?: { text?: string } } | undefined)?.body?.text ??
    (message.template ? `[template: ${(message.template as { name?: string }).name}]` : undefined) ??
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
