import { forwardRef, Module } from '@nestjs/common'
import { BotModule } from '../bot/bot.module'
import { FixedConfirmationsModule } from '../fixed-confirmations/fixed-confirmations.module'
import { WhatsAppLinesModule } from '../whatsapp-lines/whatsapp-lines.module'
import { WhatsAppController } from './whatsapp.controller'
import { WhatsAppService } from './whatsapp.service'

@Module({
  imports: [WhatsAppLinesModule, BotModule, forwardRef(() => FixedConfirmationsModule)],
  controllers: [WhatsAppController],
  providers: [WhatsAppService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
