import { Global, Module } from '@nestjs/common'
import { AiCreditAlertsService } from './ai-credit-alerts.service'
import { CreditsService } from './credits.service'
import { PlansController } from './plans.controller'
import { PlansService } from './plans.service'

/**
 * What each commercial plan includes (courts, users, AI credits, modules). Global for the same
 * reason as PricingModule: unrelated modules (courts, users, bookings, stock, the bot) each
 * create something a plan limits, and the rule must be the same everywhere.
 */
@Global()
@Module({
  controllers: [PlansController],
  providers: [PlansService, CreditsService, AiCreditAlertsService],
  exports: [PlansService, CreditsService],
})
export class PlansModule {}
