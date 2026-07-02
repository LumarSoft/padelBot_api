import { Module } from '@nestjs/common'
import { BookingsModule } from '../bookings/bookings.module'
import { AvailabilityModule } from '../availability/availability.module'
import { LlmModule } from '../llm/llm.module'
import { EventsModule } from '../events/events.module'
import { WhatsAppMediaModule } from '../whatsapp/whatsapp-media.module'
import { BotService } from './bot.service'
import { ConversationSessionService } from './conversation-session.service'

@Module({
  imports: [BookingsModule, AvailabilityModule, LlmModule, EventsModule, WhatsAppMediaModule],
  providers: [BotService, ConversationSessionService],
  exports: [BotService],
})
export class BotModule {}
