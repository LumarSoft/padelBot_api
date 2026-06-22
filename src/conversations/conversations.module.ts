import { Module } from '@nestjs/common'
import { WhatsAppModule } from '../whatsapp/whatsapp.module'
import { EventsModule } from '../events/events.module'
import { ConversationsController } from './conversations.controller'
import { ConversationsService } from './conversations.service'

@Module({
  imports: [WhatsAppModule, EventsModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
})
export class ConversationsModule {}
