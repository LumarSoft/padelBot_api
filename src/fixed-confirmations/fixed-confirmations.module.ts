import { forwardRef, Module } from '@nestjs/common'
import { BookingsModule } from '../bookings/bookings.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { WhatsAppModule } from '../whatsapp/whatsapp.module'
import { WhatsAppLinesModule } from '../whatsapp-lines/whatsapp-lines.module'
import { FixedConfirmationsService } from './fixed-confirmations.service'

@Module({
  // forwardRef: the WhatsApp webhook routes the template's button taps here, and this module
  // sends the template through WhatsAppService — the same cycle the waitlist resolves this way.
  imports: [BookingsModule, NotificationsModule, WhatsAppLinesModule, forwardRef(() => WhatsAppModule)],
  providers: [FixedConfirmationsService],
  exports: [FixedConfirmationsService],
})
export class FixedConfirmationsModule {}
