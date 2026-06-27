import { Module } from '@nestjs/common'
import { WhatsAppMediaService } from './whatsapp-media.service'

/**
 * Standalone module exposing media download, with no dependency on BotModule, so the bot
 * can import it without an import cycle (WhatsAppModule → BotModule already exists).
 */
@Module({
  providers: [WhatsAppMediaService],
  exports: [WhatsAppMediaService],
})
export class WhatsAppMediaModule {}
