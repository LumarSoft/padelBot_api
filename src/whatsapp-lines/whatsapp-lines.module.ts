import { Module } from '@nestjs/common'
import { WhatsAppLinesController } from './whatsapp-lines.controller'
import { WhatsAppLinesService } from './whatsapp-lines.service'

@Module({
  controllers: [WhatsAppLinesController],
  providers: [WhatsAppLinesService],
  exports: [WhatsAppLinesService],
})
export class WhatsAppLinesModule {}
