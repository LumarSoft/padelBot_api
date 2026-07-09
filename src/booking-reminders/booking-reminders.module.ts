import { Module } from '@nestjs/common'
import { WhatsAppModule } from '../whatsapp/whatsapp.module'
import { WhatsAppLinesModule } from '../whatsapp-lines/whatsapp-lines.module'
import { BookingRemindersService } from './booking-reminders.service'

@Module({
  imports: [WhatsAppModule, WhatsAppLinesModule],
  providers: [BookingRemindersService],
})
export class BookingRemindersModule {}
