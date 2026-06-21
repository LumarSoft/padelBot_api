import { Module } from '@nestjs/common'
import { BotModule } from '../bot/bot.module'
import { WhatsAppLinesModule } from '../whatsapp-lines/whatsapp-lines.module'
import { WhatsAppController } from './whatsapp.controller'
import { WhatsAppService } from './whatsapp.service'

@Module({
  imports: [WhatsAppLinesModule, BotModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppService],
})
export class WhatsAppModule {}
