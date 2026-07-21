import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import { Request } from 'express'
import { SkipThrottle } from '@nestjs/throttler'
import { BotService } from '../bot/bot.service'
import { BotReply, InboundMedia } from '../bot/types'
import { TECHNICAL_ERROR } from '../bot/messages'
import { KeyedSerialQueue } from '../common/keyed-serial-queue'
import { WhatsAppLinesService } from '../whatsapp-lines/whatsapp-lines.service'
import { WhatsAppService } from './whatsapp.service'

// Meta delivers (and retries) message webhooks in bursts — rate limiting would drop
// legitimate inbound messages. The endpoint is already verified by HMAC signature.
@SkipThrottle()
@Controller('')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name)
  // Serializes each sender's messages so a rapid burst is handled in order, one at a time.
  private readonly inbound = new KeyedSerialQueue()

  constructor(
    private readonly whatsappService: WhatsAppService,
    private readonly whatsappLinesService: WhatsAppLinesService,
    private readonly botService: BotService,
  ) {}

  /**
   * GET /whatsapp/webhook
   * Meta calls this once when you register the webhook URL in the dashboard.
   */
  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    // Canonical name is WHATSAPP_VERIFY_TOKEN; META_VERIFY_TOKEN kept as a fallback
    // so existing deployments don't break on the rename.
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? process.env.META_VERIFY_TOKEN
    if (mode === 'subscribe' && token === verifyToken) {
      return challenge
    }
    throw new ForbiddenException('Webhook verification failed')
  }

  /**
   * POST /whatsapp/webhook
   * Meta posts here on every incoming message.
   * We must reply 200 fast — processing runs fire-and-forget.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  receive(@Body() payload: any, @Req() req: Request): { status: string } {
    const rawBody = (req as any).rawBody as Buffer | undefined
    const signature = req.headers['x-hub-signature-256'] as string

    // Fail closed: a missing rawBody must never be treated as "skip verification".
    if (!rawBody || !this.whatsappService.verifySignature(rawBody, signature)) {
      throw new ForbiddenException('Invalid webhook signature')
    }

    this.processPayload(payload).catch(err => this.logger.error('Webhook processing error', err))

    return { status: 'ok' }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async processPayload(payload: any): Promise<void> {
    if (payload?.object !== 'whatsapp_business_account') return

    for (const entry of payload?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        if (change?.field !== 'messages') continue

        const value = change?.value
        const phoneNumberId: string | undefined = value?.metadata?.phone_number_id
        if (!phoneNumberId) continue

        for (const message of value?.messages ?? []) {
          const waId: string | undefined = message?.from
          const messageId: string | undefined = message?.id
          if (!waId || !messageId) continue

          // Skip duplicates: Meta retries deliveries, which would otherwise double-book
          // or double-charge LLM calls. claimMessage is an atomic first-writer-wins.
          if (!(await this.whatsappService.claimMessage(messageId))) continue

          // All work for a sender runs through their serial queue, so concurrent webhook
          // deliveries for the same number can't process in parallel and trample each other.
          if (message?.type === 'text') {
            const body: string | undefined = message?.text?.body
            if (!body) continue
            await this.inbound.enqueue(waId, () => this.processMessage(phoneNumberId, waId, body))
          } else if (message?.type === 'interactive') {
            // A tapped button / list row: its `id` is the exact text the FSM expects, so we
            // feed it through the same path as a typed message (no LLM call needed).
            const body = extractInteractiveReply(message)
            if (!body) continue
            await this.inbound.enqueue(waId, () => this.processMessage(phoneNumberId, waId, body))
          } else if (message?.type === 'image' || message?.type === 'document') {
            // Likely a transfer receipt. In RECEIPT mode the bot downloads and stores it for
            // the admin to verify; in AUTO mode it just acknowledges (the poller confirms).
            const media = extractMedia(message)
            await this.inbound.enqueue(waId, () => this.processAttachment(phoneNumberId, waId, media))
          }
        }
      }
    }
  }

  private async processMessage(phoneNumberId: string, waId: string, body: string): Promise<void> {
    try {
      const clubId = await this.resolveClubId(phoneNumberId)
      if (!clubId) return

      const reply = await this.botService.handleMessage(waId, clubId, body)
      await this.deliver(phoneNumberId, waId, reply)
    } catch (err) {
      // Transport-level safety net (the bot already has its own): never leave the user silent.
      this.logger.error(`Failed to process message from ${waId}`, err)
      await this.sendCourtesy(phoneNumberId, waId)
    }
  }

  private async processAttachment(phoneNumberId: string, waId: string, media: InboundMedia | null): Promise<void> {
    try {
      const clubId = await this.resolveClubId(phoneNumberId)
      if (!clubId) return

      const reply = await this.botService.handleAttachment(waId, clubId, media)
      await this.deliver(phoneNumberId, waId, reply)
    } catch (err) {
      this.logger.error(`Failed to process attachment from ${waId}`, err)
      await this.sendCourtesy(phoneNumberId, waId)
    }
  }

  /** Best-effort courtesy message; swallows its own errors so it never throws further. */
  private async sendCourtesy(phoneNumberId: string, waId: string): Promise<void> {
    try {
      await this.whatsappService.sendText(phoneNumberId, waId, TECHNICAL_ERROR)
    } catch (err) {
      this.logger.error(`Failed to send courtesy message to ${waId}`, err)
    }
  }

  /** Sends the bot's reply, as an interactive message when it carries a botonera. */
  private async deliver(phoneNumberId: string, waId: string, reply: BotReply | null): Promise<void> {
    if (!reply) return
    if (reply.interactive) {
      await this.whatsappService.sendInteractive(phoneNumberId, waId, reply.text, reply.interactive)
    } else {
      await this.whatsappService.sendText(phoneNumberId, waId, reply.text)
    }
  }

  private async resolveClubId(phoneNumberId: string): Promise<string | null> {
    try {
      const { clubId } = await this.whatsappLinesService.resolveClub(phoneNumberId)
      return clubId
    } catch {
      this.logger.warn(`No active club for phoneNumberId=${phoneNumberId} — message ignored`)
      return null
    }
  }
}

/** Pulls the selected option id out of an inbound interactive (button or list) reply. */
function extractInteractiveReply(message: any): string | undefined {
  const interactive = message?.interactive
  if (interactive?.type === 'button_reply') return interactive?.button_reply?.id
  if (interactive?.type === 'list_reply') return interactive?.list_reply?.id
  return undefined
}

/** Pulls the Meta media id + mime type out of an inbound image/document message. */
function extractMedia(message: any): InboundMedia | null {
  const node = message?.type === 'image' ? message?.image : message?.document
  const mediaId: string | undefined = node?.id
  if (!mediaId) return null
  return { mediaId, mimeType: node?.mime_type ?? null }
}
