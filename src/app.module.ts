import { Module } from '@nestjs/common'
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

@Module({
  imports: [PrismaModule, AuthModule, CourtsModule, SlotsModule, BookingsModule, RecurringBookingsModule, WhatsAppLinesModule, BotModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
