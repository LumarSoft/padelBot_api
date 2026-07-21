import { forwardRef, Module } from '@nestjs/common'
import { EventsModule } from '../events/events.module'
import { WhatsAppModule } from '../whatsapp/whatsapp.module'
import { WaitlistService } from './waitlist.service'

@Module({
  // forwardRef: WhatsAppModule → BotModule → WaitlistModule closes a cycle; the
  // waitlist only needs the send-message service, resolved lazily.
  imports: [EventsModule, forwardRef(() => WhatsAppModule)],
  providers: [WaitlistService],
  exports: [WaitlistService],
})
export class WaitlistModule {}
