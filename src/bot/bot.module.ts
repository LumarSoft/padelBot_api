import { forwardRef, Module } from '@nestjs/common'
import { WaitlistModule } from '../waitlist/waitlist.module'
import { PlayersModule } from '../players/players.module'
import { BookingsModule } from '../bookings/bookings.module'
import { AvailabilityModule } from '../availability/availability.module'
import { LlmModule } from '../llm/llm.module'
import { EventsModule } from '../events/events.module'
import { WhatsAppMediaModule } from '../whatsapp/whatsapp-media.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { BotService } from './bot.service'
import { ConversationSessionService } from './conversation-session.service'

@Module({
  imports: [
    BookingsModule,
    AvailabilityModule,
    LlmModule,
    EventsModule,
    WhatsAppMediaModule,
    NotificationsModule,
    forwardRef(() => WaitlistModule),
    PlayersModule,
  ],
  providers: [BotService, ConversationSessionService],
  exports: [BotService],
})
export class BotModule {}
