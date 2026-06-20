import { Module } from '@nestjs/common'
import { BookingsModule } from '../bookings/bookings.module'
import { BotService } from './bot.service'
import { ConversationSessionService } from './conversation-session.service'

@Module({
  imports: [BookingsModule],
  providers: [BotService, ConversationSessionService],
  exports: [BotService],
})
export class BotModule {}
