import { Module } from '@nestjs/common'
import { BillingController, BillingWebhookController } from './billing.controller'
import { BillingMercadoPagoService } from './billing-mercadopago.service'
import { BillingService } from './billing.service'

/** What clubs pay Lumarsoft beyond the plan: credit packs by MercadoPago (Lumarsoft's account). */
@Module({
  controllers: [BillingController, BillingWebhookController],
  providers: [BillingService, BillingMercadoPagoService],
  exports: [BillingService],
})
export class BillingModule {}
