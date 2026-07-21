import { Module } from '@nestjs/common'
import { BookingsModule } from '../bookings/bookings.module'
import { ClubsModule } from '../clubs/clubs.module'
import { MercadoPagoModule } from '../mercadopago/mercadopago.module'
import { WhatsAppModule } from '../whatsapp/whatsapp.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { PaymentsController } from './payments.controller'
import { PaymentsAdminController } from './payments-admin.controller'
import { PaymentsDiagnosticsController } from './payments-diagnostics.controller'
import { PaymentsService } from './payments.service'

@Module({
  imports: [BookingsModule, ClubsModule, MercadoPagoModule, WhatsAppModule, NotificationsModule],
  controllers: [PaymentsController, PaymentsAdminController, PaymentsDiagnosticsController],
  providers: [PaymentsService],
  // Exported for the ops console, which reads the poller's in-memory health across every
  // club (the per-club endpoint only ever answers for the caller's own tenant).
  exports: [PaymentsService],
})
export class PaymentsModule {}
