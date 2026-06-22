import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { CourtsModule } from './courts/courts.module'
import { SlotsModule } from './slots/slots.module'
import { BookingsModule } from './bookings/bookings.module'
import { RecurringBookingsModule } from './recurring-bookings/recurring-bookings.module'
import { WhatsAppLinesModule } from './whatsapp-lines/whatsapp-lines.module'
import { BotModule } from './bot/bot.module'
import { WhatsAppModule } from './whatsapp/whatsapp.module'
import { EventsModule } from './events/events.module'
import { PaymentsModule } from './payments/payments.module'
import { ClubsModule } from './clubs/clubs.module'
import { ConversationsModule } from './conversations/conversations.module'

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    CourtsModule,
    SlotsModule,
    BookingsModule,
    RecurringBookingsModule,
    WhatsAppLinesModule,
    BotModule,
    WhatsAppModule,
    EventsModule,
    PaymentsModule,
    ClubsModule,
    ConversationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
