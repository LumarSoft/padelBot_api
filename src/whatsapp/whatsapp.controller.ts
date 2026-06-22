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
import { BotService } from '../bot/bot.service'
import { WhatsAppLinesService } from '../whatsapp-lines/whatsapp-lines.service'
import { WhatsAppService } from './whatsapp.service'

@Controller('')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name)

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
    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
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

    if (rawBody && !this.whatsappService.verifySignature(rawBody, signature)) {
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
          if (!waId) continue

          if (message?.type === 'text') {
            const body: string | undefined = message?.text?.body
            if (!body) continue
            await this.processMessage(phoneNumberId, waId, body)
          } else if (message?.type === 'image' || message?.type === 'document') {
            // Likely a transfer receipt — acknowledge it (the poller confirms the money).
            await this.processAttachment(phoneNumberId, waId)
          }
        }
      }
    }
  }

  private async processMessage(phoneNumberId: string, waId: string, body: string): Promise<void> {
    const clubId = await this.resolveClubId(phoneNumberId)
    if (!clubId) return

    const reply = await this.botService.handleMessage(waId, clubId, body)
    if (reply !== null) {
      await this.whatsappService.sendText(phoneNumberId, waId, reply)
    }
  }

  private async processAttachment(phoneNumberId: string, waId: string): Promise<void> {
    const clubId = await this.resolveClubId(phoneNumberId)
    if (!clubId) return

    const reply = await this.botService.handleAttachment(waId, clubId)
    if (reply !== null) {
      await this.whatsappService.sendText(phoneNumberId, waId, reply)
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
