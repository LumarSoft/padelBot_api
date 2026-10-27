import { Module } from '@nestjs/common'
import { BillingController } from './billing.controller'
import { BillingService } from './billing.service'

/** The owner's "Facturación" page: what the club has with Lumarsoft (plan, subscription, credits). */
@Module({
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
