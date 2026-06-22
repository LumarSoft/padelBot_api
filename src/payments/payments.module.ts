import { Module } from '@nestjs/common'
import { BookingsModule } from '../bookings/bookings.module'
import { MercadoPagoModule } from '../mercadopago/mercadopago.module'
import { WhatsAppModule } from '../whatsapp/whatsapp.module'
import { PaymentsController } from './payments.controller'
import { PaymentsAdminController } from './payments-admin.controller'
import { PaymentsService } from './payments.service'

@Module({
  imports: [BookingsModule, MercadoPagoModule, WhatsAppModule],
  controllers: [PaymentsController, PaymentsAdminController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
