import { Module } from '@nestjs/common'
import { BookingsModule } from '../bookings/bookings.module'
import { ClubsModule } from '../clubs/clubs.module'
import { MercadoPagoModule } from '../mercadopago/mercadopago.module'
import { WhatsAppModule } from '../whatsapp/whatsapp.module'
import { PaymentsController } from './payments.controller'
import { PaymentsAdminController } from './payments-admin.controller'
import { PaymentsDiagnosticsController } from './payments-diagnostics.controller'
import { PaymentsService } from './payments.service'

@Module({
  imports: [BookingsModule, ClubsModule, MercadoPagoModule, WhatsAppModule],
  controllers: [PaymentsController, PaymentsAdminController, PaymentsDiagnosticsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
