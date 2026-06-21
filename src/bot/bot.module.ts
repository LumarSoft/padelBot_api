import { Module } from '@nestjs/common'
import { BookingsModule } from '../bookings/bookings.module'
import { AvailabilityModule } from '../availability/availability.module'
import { LlmModule } from '../llm/llm.module'
import { BotService } from './bot.service'
import { ConversationSessionService } from './conversation-session.service'

@Module({
  imports: [BookingsModule, AvailabilityModule, LlmModule],
  providers: [BotService, ConversationSessionService],
  exports: [BotService],
})
export class BotModule {}
